import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("ai-router");
import {
  conversations,
  messages,
  platforms,
  contacts,
  contactProfiles,
  notes,
  aiUsageLog,
  aiConfigs,
  creators,
  contactReports,
  coachingSessions,
  conversationModes as conversationModesTable,
} from "@/server/db/schema";
import { generateSuggestion } from "@/server/services/ai";
import type { ConversationModeContext } from "@/server/services/ai";
import { analyzeMessage } from "@/server/services/ai-analysis";
import { summarizeConversation } from "@/server/services/conversation-summary";
import { analysisQueue } from "@/server/queues";
import { generateContactReport } from "@/server/services/contact-report";
import { getPriceAdvice } from "@/server/services/price-advisor";
import { resolveAIConfig } from "@/server/services/ai-config-resolver";
import type { BehavioralSignals } from "@/server/services/scoring";
import { checkAIMessageLimit, checkReportLimit, checkFeatureAccess, checkCoachingLimit } from "@/server/services/usage-limits";
import { generateCoaching, type CoachingType } from "@/server/services/negotiation-coach";
import {
  resolveConversationMode,
  mergePersonalityWithMode,
  DEFAULT_CONVERSATION_MODES,
} from "@/server/services/conversation-mode-resolver";
import type { ConversationMode } from "@/server/services/conversation-mode-resolver";
import { getExperimentModeConfig } from "@/server/services/ab-experiment";

export const aiRouter = createTRPCRouter({
  suggest: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        fanMessage: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkAIMessageLimit(ctx.db, ctx.creatorId);

      // Resolve AI configs per task (multi-model support)
      const suggestionConfig = await resolveAIConfig(ctx.db, ctx.creatorId, "suggestion");
      const analysisConfig = await resolveAIConfig(ctx.db, ctx.creatorId, "analysis");

      if (!suggestionConfig) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No has configurado tu proveedor de IA. Ve a Configuración > Modelo IA para configurarlo.",
        });
      }

      // Get conversation with contact
      const conversation = await ctx.db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, input.conversationId),
          eq(conversations.creatorId, ctx.creatorId)
        ),
        with: {
          contact: { with: { profile: true } },
          messages: { orderBy: (m, { asc }) => [asc(m.createdAt)] },
        },
      });

      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      // Get platform personality + creator settings in parallel
      const [platform, creator] = await Promise.all([
        ctx.db.query.platforms.findFirst({
          where: and(
            eq(platforms.creatorId, ctx.creatorId),
            eq(platforms.platformType, conversation.platformType)
          ),
        }),
        ctx.db.query.creators.findFirst({
          where: eq(creators.id, ctx.creatorId),
          columns: { settings: true },
        }),
      ]);

      const creatorSettings = (creator?.settings ?? {}) as Record<string, unknown>;
      const globalInstructions = (creatorSettings.globalInstructions as string) || undefined;
      const responseLanguage = (creatorSettings.responseLanguage as string) || undefined;
      const analysisLanguage = (creatorSettings.analysisLanguage as string) || undefined;

      // Get contact notes
      const contactNotes = await ctx.db.query.notes.findMany({
        where: and(
          eq(notes.creatorId, ctx.creatorId),
          eq(notes.contactId, conversation.contactId)
        ),
      });

      // Save the fan message first
      const [fanMsg] = await ctx.db
        .insert(messages)
        .values({
          conversationId: input.conversationId,
          role: "fan",
          content: input.fanMessage,
        })
        .returning();

      // Update timestamps
      await ctx.db
        .update(conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversations.id, input.conversationId));

      await ctx.db
        .update(contacts)
        .set({ lastInteractionAt: new Date() })
        .where(eq(contacts.id, conversation.contactId));

      const conversationHistory = conversation.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Resolve conversation mode for OnlyFans
      let finalPersonality = (platform?.personalityConfig as Record<string, unknown>) ?? {};
      let conversationMode: ConversationModeContext | undefined;

      if (conversation.platformType === "onlyfans" && conversation.contact.profile) {
        const profile = conversation.contact.profile;
        const signals = (profile.behavioralSignals ?? {}) as BehavioralSignals;

        const dbModes = await ctx.db.query.conversationModes.findMany({
          where: eq(conversationModesTable.creatorId, ctx.creatorId),
        });

        const modes: ConversationMode[] = dbModes.length > 0
          ? dbModes.map((m) => ({
              modeType: m.modeType as ConversationMode["modeType"],
              name: m.name,
              description: m.description,
              tone: m.tone,
              style: m.style,
              messageLength: m.messageLength,
              objectives: (m.objectives as string[]) ?? [],
              restrictions: (m.restrictions as string[]) ?? [],
              additionalInstructions: m.additionalInstructions,
              activationCriteria: (m.activationCriteria as ConversationMode["activationCriteria"]) ?? {},
              priority: m.priority,
              isActive: m.isActive,
            }))
          : Object.values(DEFAULT_CONVERSATION_MODES).map((m) => ({ ...m, isActive: true }));

        const contactData = {
          engagementLevel: profile.engagementLevel ?? 0,
          paymentProbability: profile.paymentProbability ?? 0,
          funnelStage: profile.funnelStage ?? "cold",
          behavioralSignals: {
            messageCount: signals?.messageCount,
            sentimentTrend: signals?.sentimentTrend,
            lastMessageAt: signals?.lastMessageAt as string | undefined,
          },
          totalSpentCents: (profile as unknown as { totalSpentCents?: number }).totalSpentCents ?? 0,
        };

        const resolvedMode = resolveConversationMode(modes, contactData);
        if (resolvedMode) {
          finalPersonality = mergePersonalityWithMode(
            finalPersonality as { role?: string; tone?: string; style?: string; messageLength?: string; goals?: string[]; restrictions?: string[]; customInstructions?: string },
            resolvedMode
          );
          conversationMode = {
            modeType: resolvedMode.modeType,
            modeName: resolvedMode.name,
            modeDescription: resolvedMode.description,
          };
        }
      }

      // Check for A/B experiment override
      if (conversationMode) {
        const expResult = await getExperimentModeConfig(
          ctx.db,
          ctx.creatorId,
          conversationMode.modeType,
          conversation.contactId
        );
        if (expResult) {
          const expConfig = expResult.config;
          const overrides: Record<string, unknown> = {};
          if (expConfig.tone) overrides.tone = expConfig.tone;
          if (expConfig.style) overrides.style = expConfig.style;
          if (expConfig.messageLength) overrides.messageLength = expConfig.messageLength;
          if (expConfig.objectives) overrides.goals = expConfig.objectives;
          if (expConfig.restrictions) overrides.restrictions = expConfig.restrictions;
          if (expConfig.additionalInstructions) overrides.customInstructions = expConfig.additionalInstructions;
          finalPersonality = { ...finalPersonality, ...overrides };
        }
      }

      // Run suggestion + analysis in parallel (each may use different model)
      const analysisConfigResolved = analysisConfig ?? suggestionConfig;
      const [suggestionResult, analysisResult] = await Promise.all([
        generateSuggestion(suggestionConfig, {
          platformType: conversation.platformType,
          personality: finalPersonality,
          globalInstructions,
          contactProfile: conversation.contact.profile as Parameters<typeof generateSuggestion>[1]["contactProfile"],
          conversationHistory,
          contactNotes: contactNotes.map((n) => n.content),
          fanMessage: input.fanMessage,
          conversationMode,
          language: responseLanguage,
        }),
        analyzeMessage(analysisConfigResolved, {
          message: input.fanMessage,
          conversationHistory: conversationHistory.slice(-5),
          platformType: conversation.platformType,
          language: analysisLanguage,
        }),
      ]);

      // Enqueue profile update (processed by worker)
      if (fanMsg) {
        analysisQueue
          .add("analyze", {
            creatorId: ctx.creatorId,
            contactId: conversation.contactId,
            messageId: fanMsg.id,
            conversationId: input.conversationId,
            messageContent: input.fanMessage,
            platformType: conversation.platformType,
            conversationHistory: conversationHistory.slice(-5),
          })
          .catch((err) => {
            log.error({ err }, "Failed to enqueue analysis job");
          });
      }

      // Log both AI usages
      await ctx.db.insert(aiUsageLog).values([
        {
          creatorId: ctx.creatorId,
          requestType: "suggestion" as const,
          tokensUsed: suggestionResult.tokensUsed,
          modelUsed: `${suggestionResult.provider}/${suggestionResult.model}`,
        },
        {
          creatorId: ctx.creatorId,
          requestType: "analysis" as const,
          tokensUsed: analysisResult.tokensUsed,
          modelUsed: `${analysisConfigResolved.provider}/${analysisConfigResolved.model}`,
        },
      ]);

      return {
        suggestions: suggestionResult.suggestions,
        variants: suggestionResult.variants,
        tokensUsed: suggestionResult.tokensUsed + analysisResult.tokensUsed,
      };
    }),

  regenerate: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkAIMessageLimit(ctx.db, ctx.creatorId);

      const config = await resolveAIConfig(ctx.db, ctx.creatorId, "suggestion");

      if (!config) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No has configurado tu proveedor de IA.",
        });
      }

      const conversation = await ctx.db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, input.conversationId),
          eq(conversations.creatorId, ctx.creatorId)
        ),
        with: {
          contact: { with: { profile: true } },
          messages: { orderBy: (m, { asc }) => [asc(m.createdAt)] },
        },
      });

      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      // Find the last fan message to regenerate from
      const lastFanMessage = [...conversation.messages]
        .reverse()
        .find((m) => m.role === "fan");

      if (!lastFanMessage) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No hay mensaje del fan para regenerar.",
        });
      }

      const [platform, creator] = await Promise.all([
        ctx.db.query.platforms.findFirst({
          where: and(
            eq(platforms.creatorId, ctx.creatorId),
            eq(platforms.platformType, conversation.platformType)
          ),
        }),
        ctx.db.query.creators.findFirst({
          where: eq(creators.id, ctx.creatorId),
          columns: { settings: true },
        }),
      ]);

      const creatorSettings = (creator?.settings ?? {}) as Record<string, unknown>;
      const globalInstructions = (creatorSettings.globalInstructions as string) || undefined;
      const responseLanguage = (creatorSettings.responseLanguage as string) || undefined;

      const contactNotes = await ctx.db.query.notes.findMany({
        where: and(
          eq(notes.creatorId, ctx.creatorId),
          eq(notes.contactId, conversation.contactId)
        ),
      });

      // Get messages up to (not including) the last fan message for history
      const lastFanIndex = conversation.messages.findLastIndex(
        (m) => m.role === "fan"
      );
      const historyMessages = conversation.messages.slice(0, lastFanIndex);

      // Resolve conversation mode for OnlyFans
      let finalPersonality = (platform?.personalityConfig as Record<string, unknown>) ?? {};
      let conversationMode: ConversationModeContext | undefined;

      if (conversation.platformType === "onlyfans" && conversation.contact.profile) {
        const profile = conversation.contact.profile;
        const signals = (profile.behavioralSignals ?? {}) as BehavioralSignals;

        const dbModes = await ctx.db.query.conversationModes.findMany({
          where: eq(conversationModesTable.creatorId, ctx.creatorId),
        });

        const modes: ConversationMode[] = dbModes.length > 0
          ? dbModes.map((m) => ({
              modeType: m.modeType as ConversationMode["modeType"],
              name: m.name,
              description: m.description,
              tone: m.tone,
              style: m.style,
              messageLength: m.messageLength,
              objectives: (m.objectives as string[]) ?? [],
              restrictions: (m.restrictions as string[]) ?? [],
              additionalInstructions: m.additionalInstructions,
              activationCriteria: (m.activationCriteria as ConversationMode["activationCriteria"]) ?? {},
              priority: m.priority,
              isActive: m.isActive,
            }))
          : Object.values(DEFAULT_CONVERSATION_MODES).map((m) => ({ ...m, isActive: true }));

        const contactData = {
          engagementLevel: profile.engagementLevel ?? 0,
          paymentProbability: profile.paymentProbability ?? 0,
          funnelStage: profile.funnelStage ?? "cold",
          behavioralSignals: {
            messageCount: signals?.messageCount,
            sentimentTrend: signals?.sentimentTrend,
            lastMessageAt: signals?.lastMessageAt as string | undefined,
          },
          totalSpentCents: (profile as unknown as { totalSpentCents?: number }).totalSpentCents ?? 0,
        };

        const resolvedMode = resolveConversationMode(modes, contactData);
        if (resolvedMode) {
          finalPersonality = mergePersonalityWithMode(
            finalPersonality as { role?: string; tone?: string; style?: string; messageLength?: string; goals?: string[]; restrictions?: string[]; customInstructions?: string },
            resolvedMode
          );
          conversationMode = {
            modeType: resolvedMode.modeType,
            modeName: resolvedMode.name,
            modeDescription: resolvedMode.description,
          };
        }
      }

      // Check for A/B experiment override
      if (conversationMode) {
        const expResult = await getExperimentModeConfig(
          ctx.db,
          ctx.creatorId,
          conversationMode.modeType,
          conversation.contactId
        );
        if (expResult) {
          const expConfig = expResult.config;
          const overrides: Record<string, unknown> = {};
          if (expConfig.tone) overrides.tone = expConfig.tone;
          if (expConfig.style) overrides.style = expConfig.style;
          if (expConfig.messageLength) overrides.messageLength = expConfig.messageLength;
          if (expConfig.objectives) overrides.goals = expConfig.objectives;
          if (expConfig.restrictions) overrides.restrictions = expConfig.restrictions;
          if (expConfig.additionalInstructions) overrides.customInstructions = expConfig.additionalInstructions;
          finalPersonality = { ...finalPersonality, ...overrides };
        }
      }

      const result = await generateSuggestion(
        config,
        {
          platformType: conversation.platformType,
          personality: finalPersonality,
          globalInstructions,
          contactProfile: conversation.contact.profile as Parameters<typeof generateSuggestion>[1]["contactProfile"],
          conversationHistory: historyMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          contactNotes: contactNotes.map((n) => n.content),
          fanMessage: lastFanMessage.content,
          conversationMode,
          language: responseLanguage,
        }
      );

      await ctx.db.insert(aiUsageLog).values({
        creatorId: ctx.creatorId,
        requestType: "suggestion",
        tokensUsed: result.tokensUsed,
        modelUsed: `${result.provider}/${result.model}`,
      });

      return {
        suggestions: result.suggestions,
        variants: result.variants,
        tokensUsed: result.tokensUsed,
      };
    }),

  summarizeConversation: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const config = await resolveAIConfig(ctx.db, ctx.creatorId, "summary");

      if (!config) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No has configurado tu proveedor de IA.",
        });
      }

      const conversation = await ctx.db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, input.conversationId),
          eq(conversations.creatorId, ctx.creatorId)
        ),
        with: {
          contact: { with: { profile: true } },
          messages: { orderBy: (m, { asc }) => [asc(m.createdAt)] },
        },
      });

      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversacion no encontrada" });
      }

      const creatorForSummary = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, ctx.creatorId),
        columns: { settings: true },
      });
      const summarySettings = (creatorForSummary?.settings ?? {}) as Record<string, unknown>;

      const result = await summarizeConversation(config, {
        platformType: conversation.platformType,
        contactUsername: conversation.contact.username,
        funnelStage: conversation.contact.profile?.funnelStage ?? "cold",
        messages: conversation.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        language: (summarySettings.responseLanguage as string) || undefined,
      });

      await ctx.db
        .update(conversations)
        .set({ summary: result.summary })
        .where(eq(conversations.id, input.conversationId));

      await ctx.db.insert(aiUsageLog).values({
        creatorId: ctx.creatorId,
        requestType: "summary",
        tokensUsed: result.tokensUsed,
        modelUsed: `${config.provider}/${config.model}`,
      });

      return result;
    }),

  generateReport: protectedProcedure
    .input(z.object({ contactId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await checkReportLimit(ctx.db, ctx.creatorId);

      const config = await resolveAIConfig(ctx.db, ctx.creatorId, "report");

      if (!config) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No has configurado tu proveedor de IA.",
        });
      }

      const contact = await ctx.db.query.contacts.findFirst({
        where: and(
          eq(contacts.id, input.contactId),
          eq(contacts.creatorId, ctx.creatorId)
        ),
        with: { profile: true, conversations: true },
      });

      if (!contact) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contacto no encontrado" });
      }

      const recentMessages: { role: "fan" | "creator"; content: string }[] = [];
      for (const conv of contact.conversations.slice(-3)) {
        const msgs = await ctx.db.query.messages.findMany({
          where: eq(messages.conversationId, conv.id),
          orderBy: (m, { desc }) => [desc(m.createdAt)],
          limit: 10,
        });
        recentMessages.push(
          ...msgs.reverse().map((m) => ({ role: m.role, content: m.content }))
        );
      }

      const signals = contact.profile?.behavioralSignals as BehavioralSignals | null;

      const creatorForReport = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, ctx.creatorId),
        columns: { settings: true },
      });
      const reportSettings = (creatorForReport?.settings ?? {}) as Record<string, unknown>;

      const result = await generateContactReport(config, {
        contactUsername: contact.username,
        platformType: contact.platformType,
        funnelStage: contact.profile?.funnelStage ?? "cold",
        engagementLevel: contact.profile?.engagementLevel ?? 0,
        paymentProbability: contact.profile?.paymentProbability ?? 0,
        estimatedBudget: contact.profile?.estimatedBudget ?? "low",
        totalConversations: contact.totalConversations,
        firstInteractionAt: contact.firstInteractionAt.toISOString(),
        topics: signals?.topicFrequency
          ? Object.entries(signals.topicFrequency)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5)
              .map(([t]) => t)
          : [],
        sentimentAvg: signals?.avgSentiment ?? 0,
        sentimentTrend: signals?.sentimentTrend ?? 0,
        messageCount: signals?.messageCount ?? 0,
        recentMessages: recentMessages.slice(-10),
        language: (reportSettings.responseLanguage as string) || undefined,
      });

      const modelUsed = `${config.provider}/${config.model}`;

      await ctx.db.insert(aiUsageLog).values({
        creatorId: ctx.creatorId,
        requestType: "analysis",
        tokensUsed: result.tokensUsed,
        modelUsed,
      });

      // Persist report
      const { tokensUsed, ...reportData } = result;
      const [saved] = await ctx.db.insert(contactReports).values({
        creatorId: ctx.creatorId,
        contactId: input.contactId,
        reportData,
        modelUsed,
        tokensUsed: result.tokensUsed,
      }).returning();

      return { ...result, id: saved!.id, createdAt: saved!.createdAt };
    }),

  listReports: protectedProcedure
    .input(z.object({ contactId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: contactReports.id,
          createdAt: contactReports.createdAt,
          modelUsed: contactReports.modelUsed,
        })
        .from(contactReports)
        .where(
          and(
            eq(contactReports.creatorId, ctx.creatorId),
            eq(contactReports.contactId, input.contactId)
          )
        )
        .orderBy(contactReports.createdAt);
      return rows;
    }),

  getReport: protectedProcedure
    .input(z.object({ reportId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.contactReports.findFirst({
        where: and(
          eq(contactReports.id, input.reportId),
          eq(contactReports.creatorId, ctx.creatorId)
        ),
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  getPriceAdvice: protectedProcedure
    .input(z.object({ contactId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await checkFeatureAccess(ctx.db, ctx.creatorId, "priceAdvisor");

      const config = await resolveAIConfig(ctx.db, ctx.creatorId, "price_advice");

      if (!config) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No has configurado tu proveedor de IA.",
        });
      }

      const contact = await ctx.db.query.contacts.findFirst({
        where: and(
          eq(contacts.id, input.contactId),
          eq(contacts.creatorId, ctx.creatorId)
        ),
        with: { profile: true, conversations: true },
      });

      if (!contact) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contacto no encontrado" });
      }

      const recentMessages: { role: "fan" | "creator"; content: string }[] = [];
      const lastConv = contact.conversations.at(-1);
      if (lastConv) {
        const msgs = await ctx.db.query.messages.findMany({
          where: eq(messages.conversationId, lastConv.id),
          orderBy: (m, { desc }) => [desc(m.createdAt)],
          limit: 10,
        });
        recentMessages.push(
          ...msgs.reverse().map((m) => ({ role: m.role, content: m.content }))
        );
      }

      const signals = contact.profile?.behavioralSignals as BehavioralSignals | null;

      const creatorForPrice = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, ctx.creatorId),
        columns: { settings: true },
      });
      const priceSettings = (creatorForPrice?.settings ?? {}) as Record<string, unknown>;

      const result = await getPriceAdvice(config, {
        platformType: contact.platformType,
        funnelStage: contact.profile?.funnelStage ?? "cold",
        paymentProbability: contact.profile?.paymentProbability ?? 0,
        estimatedBudget: contact.profile?.estimatedBudget ?? "low",
        engagementLevel: contact.profile?.engagementLevel ?? 0,
        sentimentTrend: signals?.sentimentTrend ?? 0,
        topics: signals?.topicFrequency
          ? Object.entries(signals.topicFrequency)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5)
              .map(([t]) => t)
          : [],
        recentMessages,
        language: (priceSettings.responseLanguage as string) || undefined,
      });

      await ctx.db.insert(aiUsageLog).values({
        creatorId: ctx.creatorId,
        requestType: "analysis",
        tokensUsed: result.tokensUsed,
        modelUsed: `${config.provider}/${config.model}`,
      });

      return result;
    }),

  // ============================================================
  // Coaching
  // ============================================================

  getCoaching: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        coachingType: z.enum(["negotiation", "retention", "upsell"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkCoachingLimit(ctx.db, ctx.creatorId);

      const config = await resolveAIConfig(ctx.db, ctx.creatorId, "coaching");
      const fallbackConfig = config ?? (await resolveAIConfig(ctx.db, ctx.creatorId, "suggestion"));

      if (!fallbackConfig) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No has configurado tu proveedor de IA.",
        });
      }

      const conversation = await ctx.db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, input.conversationId),
          eq(conversations.creatorId, ctx.creatorId)
        ),
        with: {
          contact: { with: { profile: true } },
          messages: { orderBy: (m, { desc }) => [desc(m.createdAt)], limit: 30 },
        },
      });

      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversacion no encontrada" });
      }

      const creatorForCoaching = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, ctx.creatorId),
        columns: { settings: true },
      });
      const coachingSettings = (creatorForCoaching?.settings ?? {}) as Record<string, unknown>;

      const result = await generateCoaching(fallbackConfig, {
        coachingType: input.coachingType as CoachingType,
        platformType: conversation.platformType,
        funnelStage: conversation.contact.profile?.funnelStage ?? "cold",
        engagementLevel: conversation.contact.profile?.engagementLevel ?? 0,
        paymentProbability: conversation.contact.profile?.paymentProbability ?? 0,
        conversationHistory: conversation.messages.reverse().map((m) => ({
          role: m.role,
          content: m.content,
        })),
        language: (coachingSettings.responseLanguage as string) || undefined,
      });

      // Save coaching session
      const [session] = await ctx.db
        .insert(coachingSessions)
        .values({
          creatorId: ctx.creatorId,
          conversationId: input.conversationId,
          contactId: conversation.contactId,
          coachingType: input.coachingType,
          analysis: result,
          modelUsed: `${fallbackConfig.provider}/${fallbackConfig.model}`,
          tokensUsed: result.tokensUsed,
        })
        .returning();

      // Log AI usage
      await ctx.db.insert(aiUsageLog).values({
        creatorId: ctx.creatorId,
        requestType: "coaching",
        tokensUsed: result.tokensUsed,
        modelUsed: `${fallbackConfig.provider}/${fallbackConfig.model}`,
      });

      return { ...result, id: session!.id, createdAt: session!.createdAt };
    }),

  listCoachingSessions: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Verify conversation belongs to creator
      const conversation = await ctx.db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, input.conversationId),
          eq(conversations.creatorId, ctx.creatorId)
        ),
      });

      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversacion no encontrada" });
      }

      return ctx.db.query.coachingSessions.findMany({
        where: eq(coachingSessions.conversationId, input.conversationId),
        orderBy: (s, { desc }) => [desc(s.createdAt)],
        limit: 20,
      });
    }),

  getCoachingSession: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.query.coachingSessions.findFirst({
        where: and(
          eq(coachingSessions.id, input.id),
          eq(coachingSessions.creatorId, ctx.creatorId)
        ),
      });

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Sesion de coaching no encontrada" });
      }

      return session;
    }),
});
