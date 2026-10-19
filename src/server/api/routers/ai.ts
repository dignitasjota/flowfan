import { z } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { assertCanAccessConversation, assertCanAccessContact } from "../access";
import { createTRPCRouter, protectedProcedure, permissionProcedure } from "../trpc";
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
} from "@/server/db/schema";
import { generateSuggestion } from "@/server/services/ai";
import { summarizeConversation } from "@/server/services/conversation-summary";
import { analysisQueue } from "@/server/queues";
import { generateContactReport } from "@/server/services/contact-report";
import { getPriceAdvice } from "@/server/services/price-advisor";
import { resolveAIConfig } from "@/server/services/ai-config-resolver";
import type { BehavioralSignals } from "@/server/services/scoring";
import { checkAIMessageLimit, checkReportLimit, checkFeatureAccess, checkCoachingLimit } from "@/server/services/usage-limits";
import { generateCoaching, type CoachingType } from "@/server/services/negotiation-coach";
import { resolvePersonalityForConversation } from "@/server/services/conversation-context";
import { markExperimentReplyForContact } from "@/server/services/message-experiment";

type Db = typeof import("@/server/db").db;

/** Personalidad de la plataforma, ajustes del creador y notas del contacto. */
async function loadSuggestionContext(
  db: Db,
  creatorId: string,
  platformType: string,
  contactId: string
) {
  const [platform, creator, contactNotes] = await Promise.all([
    db.query.platforms.findFirst({
      where: and(
        eq(platforms.creatorId, creatorId),
        eq(platforms.platformType, platformType as (typeof platforms.$inferSelect)["platformType"])
      ),
    }),
    db.query.creators.findFirst({
      where: eq(creators.id, creatorId),
      columns: { settings: true },
    }),
    db.query.notes.findMany({
      where: and(eq(notes.creatorId, creatorId), eq(notes.contactId, contactId)),
    }),
  ]);
  const raw = (creator?.settings ?? {}) as Record<string, unknown>;
  return {
    platform,
    contactNotes,
    settings: {
      globalInstructions: (raw.globalInstructions as string) || undefined,
      responseLanguage: (raw.responseLanguage as string) || undefined,
      analysisLanguage: (raw.analysisLanguage as string) || undefined,
    },
  };
}

export const aiRouter = createTRPCRouter({
  suggest: permissionProcedure("conversations.send_messages")
    .input(
      z.object({
        conversationId: z.string().uuid(),
        fanMessage: z.string().min(1).max(4000), // AI-9: cap de entrada
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Ownership + acceso antes de consumir cupo.
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

      // TEN-6: los chatters solo generan sugerencias para conversaciones asignadas.
      await assertCanAccessConversation(ctx, input.conversationId);

      const suggestionConfig = await resolveAIConfig(ctx.db, ctx.creatorId, "suggestion");
      if (!suggestionConfig) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No has configurado tu proveedor de IA. Ve a Configuración > Modelo IA para configurarlo.",
        });
      }

      await checkAIMessageLimit(ctx.db, ctx.creatorId);

      const { platform, settings, contactNotes } = await loadSuggestionContext(
        ctx.db,
        ctx.creatorId,
        conversation.platformType,
        conversation.contactId
      );

      const conversationHistory = conversation.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const { personality, conversationMode } = await resolvePersonalityForConversation(ctx.db, {
        creatorId: ctx.creatorId,
        contactId: conversation.contactId,
        platformType: conversation.platformType,
        platformPersonality: platform?.personalityConfig as Record<string, unknown> | undefined,
        profile: conversation.contact.profile,
      });

      // La sugerencia se genera ANTES de persistir el mensaje del fan: si la IA
      // falla no queda un mensaje huérfano que el reintento del usuario
      // duplicaría. El análisis de sentimiento lo hace solo el worker (antes se
      // hacía también aquí en paralelo: 3 llamadas a IA por mensaje).
      const suggestionResult = await generateSuggestion(suggestionConfig, {
        platformType: conversation.platformType,
        personality,
        globalInstructions: settings.globalInstructions,
        contactProfile: conversation.contact.profile as Parameters<typeof generateSuggestion>[1]["contactProfile"],
        conversationHistory,
        contactNotes: contactNotes.map((n) => n.content),
        fanMessage: input.fanMessage,
        conversationMode,
        language: settings.responseLanguage,
      });

      const now = new Date();
      const fanMsg = await ctx.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(messages)
          .values({
            conversationId: input.conversationId,
            role: "fan",
            content: input.fanMessage,
          })
          .returning();
        await tx
          .update(conversations)
          .set({ lastMessageAt: now })
          .where(eq(conversations.id, input.conversationId));
        await tx
          .update(contacts)
          .set({ lastInteractionAt: now })
          .where(eq(contacts.id, conversation.contactId));
        await tx.insert(aiUsageLog).values({
          creatorId: ctx.creatorId,
          requestType: "suggestion" as const,
          tokensUsed: suggestionResult.tokensUsed,
          modelUsed: `${suggestionResult.provider}/${suggestionResult.model}`,
        });
        return inserted;
      });

      // Scoring/sentimiento en el worker.
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

        markExperimentReplyForContact(ctx.db, ctx.creatorId, conversation.contactId).catch(
          () => {}
        );
      }

      return {
        suggestions: suggestionResult.suggestions,
        variants: suggestionResult.variants,
        tokensUsed: suggestionResult.tokensUsed,
      };
    }),

  regenerate: permissionProcedure("conversations.send_messages")
    .input(
      z.object({
        conversationId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
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

      // TEN-6: los chatters solo generan sugerencias para conversaciones asignadas.
      await assertCanAccessConversation(ctx, input.conversationId);

      // Find the last fan message to regenerate from
      const lastFanIndex = conversation.messages.findLastIndex((m) => m.role === "fan");
      const lastFanMessage = lastFanIndex >= 0 ? conversation.messages[lastFanIndex] : undefined;

      if (!lastFanMessage) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No hay mensaje del fan para regenerar.",
        });
      }

      const config = await resolveAIConfig(ctx.db, ctx.creatorId, "suggestion");
      if (!config) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No has configurado tu proveedor de IA.",
        });
      }

      await checkAIMessageLimit(ctx.db, ctx.creatorId);

      const { platform, settings, contactNotes } = await loadSuggestionContext(
        ctx.db,
        ctx.creatorId,
        conversation.platformType,
        conversation.contactId
      );

      // Get messages up to (not including) the last fan message for history
      const historyMessages = conversation.messages.slice(0, lastFanIndex);

      const { personality, conversationMode } = await resolvePersonalityForConversation(ctx.db, {
        creatorId: ctx.creatorId,
        contactId: conversation.contactId,
        platformType: conversation.platformType,
        platformPersonality: platform?.personalityConfig as Record<string, unknown> | undefined,
        profile: conversation.contact.profile,
      });

      const result = await generateSuggestion(config, {
        platformType: conversation.platformType,
        personality,
        globalInstructions: settings.globalInstructions,
        contactProfile: conversation.contact.profile as Parameters<typeof generateSuggestion>[1]["contactProfile"],
        conversationHistory: historyMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        contactNotes: contactNotes.map((n) => n.content),
        fanMessage: lastFanMessage.content,
        conversationMode,
        language: settings.responseLanguage,
      });

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
      // AI-9: aplicar el límite mensual (antes era ilimitado en Free).
      await checkAIMessageLimit(ctx.db, ctx.creatorId);

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
      await assertCanAccessConversation(ctx, input.conversationId);

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
      await assertCanAccessContact(ctx, input.contactId);

      // TEN-15: una sola query en vez de un findMany por conversación.
      const reportConvIds = contact.conversations.slice(-3).map((c) => c.id);
      const reportMsgs = reportConvIds.length
        ? await ctx.db.query.messages.findMany({
            where: inArray(messages.conversationId, reportConvIds),
            orderBy: (m, { desc }) => [desc(m.createdAt)],
            limit: 10,
          })
        : [];
      const recentMessages = reportMsgs
        .reverse()
        .map((m) => ({ role: m.role, content: m.content }));

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
        requestType: "report", // AI-2: tipo dedicado, no contamina el cupo de reportes vía "analysis"
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
      await assertCanAccessContact(ctx, input.contactId);
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
      await assertCanAccessContact(ctx, row.contactId);
      return row;
    }),

  getPriceAdvice: protectedProcedure
    .input(z.object({ contactId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await checkFeatureAccess(ctx.db, ctx.creatorId, "priceAdvisor");
      // AI-9: contar contra el cupo mensual (antes solo validaba el flag de plan).
      await checkAIMessageLimit(ctx.db, ctx.creatorId);

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
      await assertCanAccessContact(ctx, input.contactId);

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
        requestType: "price_advice", // AI-2: tipo dedicado
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
      await assertCanAccessConversation(ctx, input.conversationId);

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
      await assertCanAccessConversation(ctx, input.conversationId);

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
      await assertCanAccessConversation(ctx, session.conversationId);

      return session;
    }),
});
