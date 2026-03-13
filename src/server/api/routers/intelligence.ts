import { z } from "zod";
import { eq, and, desc, sql, count } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  contacts,
  contactProfiles,
  conversations,
  messages,
  aiConfigs,
  aiUsageLog,
  notifications,
} from "@/server/db/schema";
import { analyzeMessage } from "@/server/services/ai-analysis";
import { updateSignals, calculateScores, type BehavioralSignals } from "@/server/services/scoring";
import { updateContactProfile } from "@/server/services/profile-updater";
import { generateProactiveActions } from "@/server/services/proactive-actions";
import { PLAN_LIMITS } from "@/server/services/usage-limits";
import { creators } from "@/server/db/schema";

export const intelligenceRouter = createTRPCRouter({
  getContactScoring: protectedProcedure
    .input(z.object({ contactId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const contact = await ctx.db.query.contacts.findFirst({
        where: and(
          eq(contacts.id, input.contactId),
          eq(contacts.creatorId, ctx.creatorId)
        ),
        with: { profile: true },
      });

      if (!contact) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contacto no encontrado" });
      }

      const profile = contact.profile;
      if (!profile) {
        return {
          engagementLevel: 0,
          paymentProbability: 0,
          funnelStage: "cold" as const,
          responseSpeed: "medium" as const,
          conversationDepth: "superficial" as const,
          estimatedBudget: "low" as const,
          factors: [],
          scoringHistory: [],
          behavioralSignals: null,
        };
      }

      // Recalculate factors from current signals
      const signals = profile.behavioralSignals as BehavioralSignals | null;
      const scores = signals
        ? calculateScores(signals, profile.funnelStage)
        : null;

      return {
        engagementLevel: profile.engagementLevel,
        paymentProbability: profile.paymentProbability,
        funnelStage: profile.funnelStage,
        responseSpeed: profile.responseSpeed,
        conversationDepth: profile.conversationDepth,
        estimatedBudget: profile.estimatedBudget,
        factors: scores?.factors ?? [],
        scoringHistory: (profile.scoringHistory as unknown[]) ?? [],
        behavioralSignals: signals,
      };
    }),

  getSentimentTrend: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const conversation = await ctx.db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, input.conversationId),
          eq(conversations.creatorId, ctx.creatorId)
        ),
      });

      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversación no encontrada" });
      }

      const msgs = await ctx.db.query.messages.findMany({
        where: eq(messages.conversationId, input.conversationId),
        orderBy: (m, { asc }) => [asc(m.createdAt)],
      });

      return msgs
        .filter((m) => m.sentiment !== null)
        .map((m) => ({
          messageId: m.id,
          role: m.role,
          sentiment: m.sentiment as {
            score: number;
            label: string;
            emotionalTone: string;
            topics: string[];
          },
          createdAt: m.createdAt,
        }));
    }),

  getContactSignals: protectedProcedure
    .input(z.object({ contactId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const contact = await ctx.db.query.contacts.findFirst({
        where: and(
          eq(contacts.id, input.contactId),
          eq(contacts.creatorId, ctx.creatorId)
        ),
        with: { profile: true },
      });

      if (!contact) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contacto no encontrado" });
      }

      return (contact.profile?.behavioralSignals as BehavioralSignals) ?? null;
    }),

  getTopContacts: protectedProcedure
    .input(
      z.object({
        sortBy: z.enum(["engagement", "payment"]).default("engagement"),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      const allContacts = await ctx.db.query.contacts.findMany({
        where: eq(contacts.creatorId, ctx.creatorId),
        with: { profile: true },
      });

      const withProfiles = allContacts
        .filter((c) => c.profile)
        .map((c) => ({
          id: c.id,
          username: c.username,
          displayName: c.displayName,
          platformType: c.platformType,
          engagementLevel: c.profile!.engagementLevel,
          paymentProbability: c.profile!.paymentProbability,
          funnelStage: c.profile!.funnelStage,
        }));

      withProfiles.sort((a, b) =>
        input.sortBy === "engagement"
          ? b.engagementLevel - a.engagementLevel
          : b.paymentProbability - a.paymentProbability
      );

      return withProfiles.slice(0, input.limit);
    }),

  recalculateProfile: protectedProcedure
    .input(z.object({ contactId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify contact belongs to creator
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

      const aiConfig = await ctx.db.query.aiConfigs.findFirst({
        where: eq(aiConfigs.creatorId, ctx.creatorId),
      });

      if (!aiConfig) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No has configurado tu proveedor de IA.",
        });
      }

      // Get all fan messages across conversations
      const allMessages: { id: string; content: string; role: string; createdAt: Date; conversationId: string }[] = [];
      for (const conv of contact.conversations) {
        const msgs = await ctx.db.query.messages.findMany({
          where: eq(messages.conversationId, conv.id),
          orderBy: (m, { asc }) => [asc(m.createdAt)],
        });
        allMessages.push(...msgs);
      }

      const fanMessages = allMessages
        .filter((m) => m.role === "fan")
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      if (fanMessages.length === 0) {
        return { message: "No hay mensajes de fan para analizar." };
      }

      // Analyze each fan message and accumulate signals
      let totalTokens = 0;
      const config = {
        provider: aiConfig.provider,
        model: aiConfig.model,
        apiKey: aiConfig.apiKey,
      };

      for (const msg of fanMessages) {
        const analysis = await analyzeMessage(config, {
          message: msg.content,
          platformType: contact.platformType,
        });

        totalTokens += analysis.tokensUsed;
        await updateContactProfile(ctx.db, input.contactId, msg.id, analysis);
      }

      // Log AI usage
      await ctx.db.insert(aiUsageLog).values({
        creatorId: ctx.creatorId,
        requestType: "analysis",
        tokensUsed: totalTokens,
        modelUsed: `${aiConfig.provider}/${aiConfig.model}`,
      });

      return {
        message: `Perfil recalculado con ${fanMessages.length} mensajes analizados.`,
        messagesAnalyzed: fanMessages.length,
        tokensUsed: totalTokens,
      };
    }),

  getDashboardStats: protectedProcedure.query(async ({ ctx }) => {
    const allContacts = await ctx.db.query.contacts.findMany({
      where: eq(contacts.creatorId, ctx.creatorId),
      with: { profile: true },
    });

    const withProfiles = allContacts.filter((c) => c.profile);

    // Funnel distribution
    const funnelDist: Record<string, number> = {
      cold: 0,
      curious: 0,
      interested: 0,
      hot_lead: 0,
      buyer: 0,
      vip: 0,
    };
    let totalEngagement = 0;
    let totalPayment = 0;

    for (const c of withProfiles) {
      const stage = c.profile!.funnelStage;
      funnelDist[stage] = (funnelDist[stage] ?? 0) + 1;
      totalEngagement += c.profile!.engagementLevel;
      totalPayment += c.profile!.paymentProbability;
    }

    const count = withProfiles.length || 1;

    // Top contacts by payment probability
    const topByPayment = withProfiles
      .sort((a, b) => b.profile!.paymentProbability - a.profile!.paymentProbability)
      .slice(0, 5)
      .map((c) => ({
        id: c.id,
        username: c.username,
        displayName: c.displayName,
        platformType: c.platformType,
        paymentProbability: c.profile!.paymentProbability,
        funnelStage: c.profile!.funnelStage,
        engagementLevel: c.profile!.engagementLevel,
      }));

    // Recent notifications
    const recentNotifs = await ctx.db.query.notifications.findMany({
      where: eq(notifications.creatorId, ctx.creatorId),
      orderBy: (n, { desc }) => [desc(n.createdAt)],
      limit: 10,
    });

    return {
      totalContacts: allContacts.length,
      analyzedContacts: withProfiles.length,
      avgEngagement: Math.round(totalEngagement / count),
      avgPaymentProbability: Math.round(totalPayment / count),
      funnelDistribution: funnelDist,
      topByPayment,
      recentNotifications: recentNotifs,
    };
  }),

  getNotifications: protectedProcedure
    .input(
      z.object({
        unreadOnly: z.boolean().default(false),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const where = input.unreadOnly
        ? and(
            eq(notifications.creatorId, ctx.creatorId),
            eq(notifications.isRead, false)
          )
        : eq(notifications.creatorId, ctx.creatorId);

      return ctx.db.query.notifications.findMany({
        where,
        orderBy: (n, { desc }) => [desc(n.createdAt)],
        limit: input.limit,
      });
    }),

  getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
    const result = await ctx.db
      .select({ count: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.creatorId, ctx.creatorId),
          eq(notifications.isRead, false)
        )
      );
    return result[0]?.count ?? 0;
  }),

  markNotificationRead: protectedProcedure
    .input(z.object({ notificationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(
            eq(notifications.id, input.notificationId),
            eq(notifications.creatorId, ctx.creatorId)
          )
        );
      return { success: true };
    }),

  markAllNotificationsRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.creatorId, ctx.creatorId));
    return { success: true };
  }),

  getProactiveActions: protectedProcedure.query(async ({ ctx }) => {
    const allContacts = await ctx.db.query.contacts.findMany({
      where: and(
        eq(contacts.creatorId, ctx.creatorId),
        eq(contacts.isArchived, false)
      ),
      with: { profile: true },
    });

    return generateProactiveActions(
      allContacts.map((c) => ({
        id: c.id,
        username: c.username,
        displayName: c.displayName,
        platformType: c.platformType,
        lastInteractionAt: c.lastInteractionAt,
        totalConversations: c.totalConversations,
        profile: c.profile
          ? {
              engagementLevel: c.profile.engagementLevel,
              paymentProbability: c.profile.paymentProbability,
              funnelStage: c.profile.funnelStage,
              estimatedBudget: c.profile.estimatedBudget,
              behavioralSignals: c.profile.behavioralSignals as BehavioralSignals | null,
            }
          : null,
      }))
    );
  }),

  exportContactsData: protectedProcedure
    .input(z.object({ format: z.enum(["json", "csv"]).default("json") }))
    .query(async ({ ctx, input }) => {
      // Check export access based on plan
      const creator = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, ctx.creatorId),
        columns: { subscriptionPlan: true },
      });
      const plan = (creator?.subscriptionPlan ?? "free") as keyof typeof PLAN_LIMITS;
      const limits = PLAN_LIMITS[plan];

      if (limits.export === "none") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `La exportacion de datos no esta disponible en el plan ${plan}. Actualiza tu plan para acceder.`,
        });
      }

      if (input.format === "json" && limits.export === "csv") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `La exportacion en JSON no esta disponible en el plan ${plan}. Solo se permite CSV. Actualiza a Pro para exportar en JSON.`,
        });
      }

      const allContacts = await ctx.db.query.contacts.findMany({
        where: eq(contacts.creatorId, ctx.creatorId),
        with: { profile: true },
      });

      const rows = allContacts.map((c) => ({
        username: c.username,
        displayName: c.displayName ?? "",
        platformType: c.platformType,
        totalConversations: c.totalConversations,
        firstInteractionAt: c.firstInteractionAt.toISOString(),
        lastInteractionAt: c.lastInteractionAt.toISOString(),
        engagementLevel: c.profile?.engagementLevel ?? 0,
        paymentProbability: c.profile?.paymentProbability ?? 0,
        funnelStage: c.profile?.funnelStage ?? "cold",
        responseSpeed: c.profile?.responseSpeed ?? "medium",
        conversationDepth: c.profile?.conversationDepth ?? "superficial",
        estimatedBudget: c.profile?.estimatedBudget ?? "low",
      }));

      if (input.format === "csv") {
        const headers = Object.keys(rows[0] ?? {}).join(",");
        const lines = rows.map((r) =>
          Object.values(r)
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(",")
        );
        return { data: [headers, ...lines].join("\n"), format: "csv" as const };
      }

      return { data: JSON.stringify(rows, null, 2), format: "json" as const };
    }),
});
