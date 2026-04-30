import { z } from "zod";
import { eq, and, desc, gte, lte, sql, count } from "drizzle-orm";
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
  fanTransactions,
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

  getEnhancedDashboardStats: protectedProcedure
    .input(
      z.object({
        period: z.enum(["30d", "60d", "90d"]).default("30d"),
      })
    )
    .query(async ({ ctx, input }) => {
      const days = input.period === "30d" ? 30 : input.period === "60d" ? 60 : 90;
      const now = new Date();
      const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const prevPeriodStart = new Date(periodStart.getTime() - days * 24 * 60 * 60 * 1000);

      // --- Revenue trend (daily) ---
      const revenueTrend = await ctx.db
        .select({
          date: sql<string>`date_trunc('day', ${fanTransactions.transactionDate})::date::text`,
          totalEur: sql<number>`COALESCE(SUM(${fanTransactions.amount}), 0)::float / 100`,
          count: count(),
        })
        .from(fanTransactions)
        .where(
          and(
            eq(fanTransactions.creatorId, ctx.creatorId),
            gte(fanTransactions.transactionDate, periodStart)
          )
        )
        .groupBy(sql`date_trunc('day', ${fanTransactions.transactionDate})::date`)
        .orderBy(sql`date_trunc('day', ${fanTransactions.transactionDate})::date`);

      // --- Revenue period comparison ---
      const [currentRevenue] = await ctx.db
        .select({ total: sql<number>`COALESCE(SUM(${fanTransactions.amount}), 0)::float / 100` })
        .from(fanTransactions)
        .where(
          and(
            eq(fanTransactions.creatorId, ctx.creatorId),
            gte(fanTransactions.transactionDate, periodStart)
          )
        );
      const [prevRevenue] = await ctx.db
        .select({ total: sql<number>`COALESCE(SUM(${fanTransactions.amount}), 0)::float / 100` })
        .from(fanTransactions)
        .where(
          and(
            eq(fanTransactions.creatorId, ctx.creatorId),
            gte(fanTransactions.transactionDate, prevPeriodStart),
            lte(fanTransactions.transactionDate, periodStart)
          )
        );
      const currentTotal = currentRevenue?.total ?? 0;
      const prevTotal = prevRevenue?.total ?? 0;
      const revenueChangePercent =
        prevTotal > 0 ? Math.round(((currentTotal - prevTotal) / prevTotal) * 100) : currentTotal > 0 ? 100 : 0;

      // --- Funnel conversion (snapshot) ---
      const allContacts = await ctx.db.query.contacts.findMany({
        where: and(eq(contacts.creatorId, ctx.creatorId), eq(contacts.isArchived, false)),
        with: { profile: true },
      });
      const stages = ["cold", "curious", "interested", "hot_lead", "buyer", "vip"] as const;
      const funnelCounts: Record<string, number> = {};
      for (const s of stages) funnelCounts[s] = 0;
      for (const c of allContacts) {
        const stage = c.profile?.funnelStage ?? "cold";
        funnelCounts[stage] = (funnelCounts[stage] ?? 0) + 1;
      }
      const totalActive = allContacts.length || 1;
      // Conversion = contacts that have progressed past each stage
      const funnelConversion = stages.slice(0, -1).map((stage, i) => {
        const nextStage = stages[i + 1]!;
        const atOrBeyond = stages.slice(i + 1).reduce((sum, s) => sum + (funnelCounts[s] ?? 0), 0);
        const atOrBeyondCurrent = stages.slice(i).reduce((sum, s) => sum + (funnelCounts[s] ?? 0), 0);
        return {
          from: stage,
          to: nextStage,
          rate: atOrBeyondCurrent > 0 ? Math.round((atOrBeyond / atOrBeyondCurrent) * 100) : 0,
        };
      });

      // --- Churn rate ---
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const inactiveCount = allContacts.filter(
        (c) => c.lastInteractionAt < thirtyDaysAgo
      ).length;
      const churnRate = Math.round((inactiveCount / totalActive) * 100);

      // --- ROI per platform ---
      const platformROI = await ctx.db
        .select({
          platform: contacts.platformType,
          totalEur: sql<number>`COALESCE(SUM(${fanTransactions.amount}), 0)::float / 100`,
          contactCount: sql<number>`COUNT(DISTINCT ${contacts.id})::int`,
        })
        .from(fanTransactions)
        .innerJoin(contacts, eq(fanTransactions.contactId, contacts.id))
        .where(eq(fanTransactions.creatorId, ctx.creatorId))
        .groupBy(contacts.platformType);

      // --- Contacts at risk ---
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const atRisk = allContacts
        .filter((c) => {
          if (!c.profile) return false;
          const engagement = c.profile.engagementLevel;
          const lastInteraction = c.lastInteractionAt;
          // Had engagement but inactive 14-30 days
          return engagement > 20 && lastInteraction < fourteenDaysAgo && lastInteraction >= thirtyDaysAgo;
        })
        .sort((a, b) => (b.profile?.engagementLevel ?? 0) - (a.profile?.engagementLevel ?? 0))
        .slice(0, 10)
        .map((c) => {
          const daysSince = Math.floor(
            (now.getTime() - c.lastInteractionAt.getTime()) / (24 * 60 * 60 * 1000)
          );
          return {
            id: c.id,
            username: c.username,
            displayName: c.displayName,
            platformType: c.platformType,
            engagementLevel: c.profile!.engagementLevel,
            funnelStage: c.profile!.funnelStage,
            daysSinceInteraction: daysSince,
          };
        });

      // --- Average creator response time (last 30 days) ---
      const recentConversations = await ctx.db.query.conversations.findMany({
        where: and(
          eq(conversations.creatorId, ctx.creatorId),
          gte(conversations.lastMessageAt, thirtyDaysAgo)
        ),
        columns: { id: true },
        limit: 500,
      });

      let totalResponseMs = 0;
      let responseCount = 0;

      for (const conv of recentConversations) {
        const msgs = await ctx.db.query.messages.findMany({
          where: eq(messages.conversationId, conv.id),
          orderBy: (m, { asc }) => [asc(m.createdAt)],
          columns: { role: true, createdAt: true },
        });

        for (let i = 1; i < msgs.length; i++) {
          if (msgs[i - 1]!.role === "fan" && msgs[i]!.role === "creator") {
            const diff = msgs[i]!.createdAt.getTime() - msgs[i - 1]!.createdAt.getTime();
            if (diff > 0 && diff < 24 * 60 * 60 * 1000) {
              // Ignore >24h gaps
              totalResponseMs += diff;
              responseCount++;
            }
          }
        }
      }

      const avgResponseMinutes =
        responseCount > 0 ? Math.round(totalResponseMs / responseCount / 60000) : null;

      return {
        revenueTrend,
        currentRevenueEur: currentTotal,
        revenueChangePercent,
        funnelConversion,
        churnRate,
        inactiveCount,
        platformROI,
        atRiskContacts: atRisk,
        avgResponseMinutes,
        period: input.period,
      };
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
