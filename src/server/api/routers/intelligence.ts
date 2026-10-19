import { z } from "zod";
import { eq, and, desc, gte, lte, sql, count, inArray } from "drizzle-orm";
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
import { PLAN_LIMITS, checkAIMessageLimit } from "@/server/services/usage-limits";
import { resolveAIConfig } from "@/server/services/ai-config-resolver";

/** Tope de mensajes analizados al recalcular un perfil (coste de IA acotado). */
const RECALCULATE_MAX_MESSAGES = 50;
const PROACTIVE_MAX_CONTACTS = 2000;
import { creators } from "@/server/db/schema";
import { toCsv } from "@/lib/csv";
import { assertCanAccessContact, assertCanAccessConversation } from "../access";

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
      await assertCanAccessContact(ctx, input.contactId);

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
      await assertCanAccessConversation(ctx, input.conversationId);

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
      await assertCanAccessContact(ctx, input.contactId);

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
      // Orden y límite en SQL (antes se cargaban todos los contactos).
      const orderCol =
        input.sortBy === "engagement"
          ? contactProfiles.engagementLevel
          : contactProfiles.paymentProbability;
      return ctx.db
        .select({
          id: contacts.id,
          username: contacts.username,
          displayName: contacts.displayName,
          platformType: contacts.platformType,
          engagementLevel: contactProfiles.engagementLevel,
          paymentProbability: contactProfiles.paymentProbability,
          funnelStage: contactProfiles.funnelStage,
        })
        .from(contacts)
        .innerJoin(contactProfiles, eq(contactProfiles.contactId, contacts.id))
        .where(eq(contacts.creatorId, ctx.creatorId))
        .orderBy(desc(orderCol))
        .limit(input.limit);
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
        with: { conversations: { columns: { id: true } } },
      });

      if (!contact) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contacto no encontrado" });
      }
      await assertCanAccessContact(ctx, input.contactId);

      // Config resuelta y DESCIFRADA (antes se pasaba la apiKey cifrada al
      // proveedor y toda llamada fallaba con 401).
      const config = await resolveAIConfig(ctx.db, ctx.creatorId, "analysis");
      if (!config) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No has configurado tu proveedor de IA.",
        });
      }

      const convIds = contact.conversations.map((c) => c.id);
      const fanMessages = convIds.length
        ? (
            await ctx.db.query.messages.findMany({
              where: and(inArray(messages.conversationId, convIds), eq(messages.role, "fan")),
              orderBy: (m, { desc }) => [desc(m.createdAt)],
              limit: RECALCULATE_MAX_MESSAGES,
              columns: { id: true, content: true },
            })
          ).reverse()
        : [];

      if (fanMessages.length === 0) {
        return { message: "No hay mensajes de fan para analizar." };
      }

      // Una sola unidad de cupo por recálculo (cada mensaje es una llamada).
      await checkAIMessageLimit(ctx.db, ctx.creatorId);

      // Recalcular DESDE CERO: el primer mensaje parte de señales vacías; los
      // siguientes acumulan sobre esas. Antes se sumaba sobre las señales ya
      // existentes y cada recálculo duplicaba contadores y temas.
      let totalTokens = 0;
      for (const [idx, msg] of fanMessages.entries()) {
        const analysis = await analyzeMessage(config, {
          message: msg.content,
          platformType: contact.platformType,
        });
        totalTokens += analysis.tokensUsed;
        await updateContactProfile(
          ctx.db,
          input.contactId,
          msg.id,
          analysis,
          ctx.creatorId,
          { messageLength: msg.content.length, resetSignals: idx === 0 }
        );
      }

      await ctx.db.insert(aiUsageLog).values({
        creatorId: ctx.creatorId,
        requestType: "analysis",
        tokensUsed: totalTokens,
        modelUsed: `${config.provider}/${config.model}`,
      });

      return {
        message: `Perfil recalculado con ${fanMessages.length} mensajes analizados.`,
        messagesAnalyzed: fanMessages.length,
        tokensUsed: totalTokens,
      };
    }),

  getDashboardStats: protectedProcedure.query(async ({ ctx }) => {
    // Agregados en SQL (antes: todos los contactos + perfiles en memoria).
    const [totals] = await ctx.db
      .select({
        totalContacts: count(),
        analyzedContacts: count(contactProfiles.id),
        avgEngagement: sql<number>`COALESCE(AVG(${contactProfiles.engagementLevel}), 0)`,
        avgPayment: sql<number>`COALESCE(AVG(${contactProfiles.paymentProbability}), 0)`,
      })
      .from(contacts)
      .leftJoin(contactProfiles, eq(contactProfiles.contactId, contacts.id))
      .where(eq(contacts.creatorId, ctx.creatorId));

    const funnelRows = await ctx.db
      .select({ stage: contactProfiles.funnelStage, count: count() })
      .from(contacts)
      .innerJoin(contactProfiles, eq(contactProfiles.contactId, contacts.id))
      .where(eq(contacts.creatorId, ctx.creatorId))
      .groupBy(contactProfiles.funnelStage);

    const funnelDist: Record<string, number> = {
      cold: 0,
      curious: 0,
      interested: 0,
      hot_lead: 0,
      buyer: 0,
      vip: 0,
    };
    for (const r of funnelRows) funnelDist[r.stage] = r.count;

    const topByPayment = await ctx.db
      .select({
        id: contacts.id,
        username: contacts.username,
        displayName: contacts.displayName,
        platformType: contacts.platformType,
        paymentProbability: contactProfiles.paymentProbability,
        funnelStage: contactProfiles.funnelStage,
        engagementLevel: contactProfiles.engagementLevel,
      })
      .from(contacts)
      .innerJoin(contactProfiles, eq(contactProfiles.contactId, contacts.id))
      .where(eq(contacts.creatorId, ctx.creatorId))
      .orderBy(desc(contactProfiles.paymentProbability))
      .limit(5);

    // Recent notifications
    const recentNotifs = await ctx.db.query.notifications.findMany({
      where: eq(notifications.creatorId, ctx.creatorId),
      orderBy: (n, { desc }) => [desc(n.createdAt)],
      limit: 10,
    });

    return {
      totalContacts: totals?.totalContacts ?? 0,
      analyzedContacts: totals?.analyzedContacts ?? 0,
      avgEngagement: Math.round(Number(totals?.avgEngagement ?? 0)),
      avgPaymentProbability: Math.round(Number(totals?.avgPayment ?? 0)),
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
    // Acotado a los contactos con actividad más reciente (antes sin límite).
    const allContacts = await ctx.db.query.contacts.findMany({
      where: and(
        eq(contacts.creatorId, ctx.creatorId),
        eq(contacts.isArchived, false)
      ),
      with: { profile: true },
      orderBy: (c, { desc }) => [desc(c.lastInteractionAt)],
      limit: PROACTIVE_MAX_CONTACTS,
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
      // Agregado en SQL (antes se cargaban todos los contactos con su perfil).
      const stages = ["cold", "curious", "interested", "hot_lead", "buyer", "vip"] as const;
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const activeContactWhere = and(
        eq(contacts.creatorId, ctx.creatorId),
        eq(contacts.isArchived, false)
      );
      const funnelRows = await ctx.db
        .select({
          stage: sql<string>`COALESCE(${contactProfiles.funnelStage}::text, 'cold')`,
          count: count(),
        })
        .from(contacts)
        .leftJoin(contactProfiles, eq(contactProfiles.contactId, contacts.id))
        .where(activeContactWhere)
        .groupBy(sql`COALESCE(${contactProfiles.funnelStage}::text, 'cold')`);
      const funnelCounts: Record<string, number> = {};
      for (const st of stages) funnelCounts[st] = 0;
      let totalContactsActive = 0;
      for (const r of funnelRows) {
        funnelCounts[r.stage] = (funnelCounts[r.stage] ?? 0) + r.count;
        totalContactsActive += r.count;
      }
      const totalActive = totalContactsActive || 1;
      // Conversion = contacts that have progressed past each stage
      const funnelConversion = stages.slice(0, -1).map((stage, i) => {
        const nextStage = stages[i + 1]!;
        const atOrBeyond = stages.slice(i + 1).reduce((sum, st) => sum + (funnelCounts[st] ?? 0), 0);
        const atOrBeyondCurrent = stages.slice(i).reduce((sum, st) => sum + (funnelCounts[st] ?? 0), 0);
        return {
          from: stage,
          to: nextStage,
          rate: atOrBeyondCurrent > 0 ? Math.round((atOrBeyond / atOrBeyondCurrent) * 100) : 0,
        };
      });

      // --- Churn rate ---
      const [inactiveRow] = await ctx.db
        .select({ count: count() })
        .from(contacts)
        .where(and(activeContactWhere, lte(contacts.lastInteractionAt, thirtyDaysAgo)));
      const inactiveCount = inactiveRow?.count ?? 0;
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
      // Had engagement but inactive 14-30 days
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const atRiskRows = await ctx.db
        .select({
          id: contacts.id,
          username: contacts.username,
          displayName: contacts.displayName,
          platformType: contacts.platformType,
          lastInteractionAt: contacts.lastInteractionAt,
          engagementLevel: contactProfiles.engagementLevel,
          funnelStage: contactProfiles.funnelStage,
        })
        .from(contacts)
        .innerJoin(contactProfiles, eq(contactProfiles.contactId, contacts.id))
        .where(
          and(
            activeContactWhere,
            sql`${contactProfiles.engagementLevel} > 20`,
            lte(contacts.lastInteractionAt, fourteenDaysAgo),
            gte(contacts.lastInteractionAt, thirtyDaysAgo)
          )
        )
        .orderBy(desc(contactProfiles.engagementLevel))
        .limit(10);
      const atRisk = atRiskRows.map((c) => ({
        id: c.id,
        username: c.username,
        displayName: c.displayName,
        platformType: c.platformType,
        engagementLevel: c.engagementLevel,
        funnelStage: c.funnelStage,
        daysSinceInteraction: Math.floor(
          (now.getTime() - c.lastInteractionAt.getTime()) / (24 * 60 * 60 * 1000)
        ),
      }));

      // --- Average creator response time (last 30 days) ---
      // Una sola query con LAG() en vez de cargar los mensajes de hasta 500
      // conversaciones una a una (N+1). Solo pares fan→creador con <24h.
      const responseRows = await ctx.db.execute<{ avg_ms: string | number | null; n: string | number }>(sql`
        SELECT AVG(diff_ms) AS avg_ms, COUNT(*) AS n FROM (
          SELECT
            EXTRACT(EPOCH FROM (m.created_at - LAG(m.created_at) OVER w)) * 1000 AS diff_ms,
            m.role AS role,
            LAG(m.role) OVER w AS prev_role
          FROM ${messages} m
          JOIN ${conversations} c ON c.id = m.conversation_id
          WHERE c.creator_id = ${ctx.creatorId}
            AND m.created_at >= ${thirtyDaysAgo}
          WINDOW w AS (PARTITION BY m.conversation_id ORDER BY m.created_at)
        ) t
        WHERE t.prev_role = 'fan' AND t.role = 'creator'
          AND t.diff_ms > 0 AND t.diff_ms < 86400000
      `);
      const responseRow = (responseRows as unknown as { avg_ms: string | number | null; n: string | number }[])[0];
      const avgResponseMinutes =
        responseRow && Number(responseRow.n) > 0 && responseRow.avg_ms !== null
          ? Math.round(Number(responseRow.avg_ms) / 60000)
          : null;

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
        const headers = Object.keys(rows[0] ?? {});
        return { data: toCsv(headers, rows), format: "csv" as const };
      }

      return { data: JSON.stringify(rows, null, 2), format: "json" as const };
    }),

  // ============================================================
  // Churn Dashboard
  // ============================================================

  getChurnDashboard: protectedProcedure.query(async ({ ctx }) => {
    const { getSuggestedActions } = await import("@/server/services/churn-prediction");

    const atRiskContacts = await ctx.db
      .select({
        id: contacts.id,
        username: contacts.username,
        displayName: contacts.displayName,
        platformType: contacts.platformType,
        lastInteractionAt: contacts.lastInteractionAt,
        churnScore: contactProfiles.churnScore,
        churnFactors: contactProfiles.churnFactors,
        funnelStage: contactProfiles.funnelStage,
        engagementLevel: contactProfiles.engagementLevel,
      })
      .from(contacts)
      .innerJoin(contactProfiles, eq(contactProfiles.contactId, contacts.id))
      .where(
        and(
          eq(contacts.creatorId, ctx.creatorId),
          eq(contacts.isArchived, false),
          gte(contactProfiles.churnScore, 50)
        )
      )
      .orderBy(desc(contactProfiles.churnScore))
      .limit(20);

    let criticalCount = 0;
    let highCount = 0;
    let mediumCount = 0;

    // Count all risk levels (not just top 20)
    const allRiskCounts = await ctx.db
      .select({
        churnScore: contactProfiles.churnScore,
      })
      .from(contacts)
      .innerJoin(contactProfiles, eq(contactProfiles.contactId, contacts.id))
      .where(
        and(
          eq(contacts.creatorId, ctx.creatorId),
          eq(contacts.isArchived, false),
          gte(contactProfiles.churnScore, 25)
        )
      );

    for (const r of allRiskCounts) {
      if (r.churnScore >= 75) criticalCount++;
      else if (r.churnScore >= 50) highCount++;
      else mediumCount++;
    }

    const now = Date.now();
    const enrichedContacts = atRiskContacts.map((c) => ({
      id: c.id,
      username: c.username,
      displayName: c.displayName,
      platformType: c.platformType,
      churnScore: c.churnScore,
      funnelStage: c.funnelStage,
      engagementLevel: c.engagementLevel,
      daysSinceInteraction: Math.floor((now - c.lastInteractionAt.getTime()) / (1000 * 60 * 60 * 24)),
      suggestedAction: getSuggestedActions(c.funnelStage)[0] ?? "Enviar mensaje",
      riskLevel: c.churnScore >= 75 ? "critical" : "high",
    }));

    return {
      criticalCount,
      highCount,
      mediumCount,
      atRiskContacts: enrichedContacts,
    };
  }),

  getContactChurnDetails: protectedProcedure
    .input(z.object({ contactId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { getSuggestedActions } = await import("@/server/services/churn-prediction");

      // TEN-4: verificar que el contacto es del tenant antes de leer su churn.
      const contact = await ctx.db.query.contacts.findFirst({
        where: and(
          eq(contacts.id, input.contactId),
          eq(contacts.creatorId, ctx.creatorId)
        ),
        columns: { id: true },
      });
      if (!contact) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contacto no encontrado" });
      }
      await assertCanAccessContact(ctx, input.contactId);

      const profile = await ctx.db.query.contactProfiles.findFirst({
        where: eq(contactProfiles.contactId, input.contactId),
        columns: {
          churnScore: true,
          churnFactors: true,
          funnelStage: true,
          churnUpdatedAt: true,
        },
      });

      if (!profile) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Perfil no encontrado" });
      }

      const riskLevel = profile.churnScore >= 75
        ? "critical"
        : profile.churnScore >= 50
          ? "high"
          : profile.churnScore >= 25
            ? "medium"
            : "low";

      return {
        churnScore: profile.churnScore,
        factors: profile.churnFactors as { name: string; score: number; weight: number; description: string }[],
        riskLevel,
        suggestedActions: getSuggestedActions(profile.funnelStage),
        updatedAt: profile.churnUpdatedAt,
      };
    }),

  // ============================================================
  // Audience Insights
  // ============================================================

  audienceInsights: protectedProcedure
    .input(
      z
        .object({
          sinceDays: z.number().int().min(1).max(365).default(30),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const { computeAudienceInsights } = await import(
        "@/server/services/audience-insights"
      );
      return computeAudienceInsights(ctx.db, ctx.creatorId, {
        sinceDays: input?.sinceDays ?? 30,
      });
    }),

  // ============================================================
  // Unified Calendar (scheduled posts + scheduled messages)
  // ============================================================

  unifiedCalendar: protectedProcedure
    .input(
      z.object({
        year: z.number().int(),
        month: z.number().int().min(0).max(11),
      })
    )
    .query(async ({ ctx, input }) => {
      const { scheduledPosts, scheduledMessages, contacts } = await import(
        "@/server/db/schema"
      );

      const start = new Date(input.year, input.month, 1);
      const end = new Date(input.year, input.month + 1, 1);

      const [posts, messages] = await Promise.all([
        ctx.db.query.scheduledPosts.findMany({
          where: and(
            eq(scheduledPosts.creatorId, ctx.creatorId),
            gte(scheduledPosts.scheduleAt, start),
            lte(scheduledPosts.scheduleAt, end)
          ),
          columns: {
            id: true,
            title: true,
            content: true,
            scheduleAt: true,
            status: true,
            targetPlatforms: true,
            recurrenceRule: true,
          },
        }),
        ctx.db
          .select({
            id: scheduledMessages.id,
            content: scheduledMessages.content,
            scheduledAt: scheduledMessages.scheduledAt,
            status: scheduledMessages.status,
            contactUsername: contacts.username,
            contactDisplayName: contacts.displayName,
            platformType: contacts.platformType,
          })
          .from(scheduledMessages)
          .leftJoin(contacts, eq(scheduledMessages.contactId, contacts.id))
          .where(
            and(
              eq(scheduledMessages.creatorId, ctx.creatorId),
              gte(scheduledMessages.scheduledAt, start),
              lte(scheduledMessages.scheduledAt, end)
            )
          ),
      ]);

      type CalendarEvent =
        | {
            type: "post";
            id: string;
            date: Date;
            title: string | null;
            content: string;
            status: string;
            platforms: string[];
            isRecurring: boolean;
          }
        | {
            type: "message";
            id: string;
            date: Date;
            title: string | null;
            content: string;
            status: string;
            platforms: string[];
            contactName: string | null;
          };

      const events: CalendarEvent[] = [
        ...posts.map(
          (p): CalendarEvent => ({
            type: "post",
            id: p.id,
            date: p.scheduleAt,
            title: p.title,
            content: p.content,
            status: p.status,
            platforms: p.targetPlatforms ?? [],
            isRecurring: !!p.recurrenceRule,
          })
        ),
        ...messages.map(
          (m): CalendarEvent => ({
            type: "message",
            id: m.id,
            date: m.scheduledAt,
            title: m.contactDisplayName ?? m.contactUsername ?? null,
            content: m.content,
            status: m.status,
            platforms: m.platformType ? [m.platformType] : [],
            contactName: m.contactDisplayName ?? m.contactUsername,
          })
        ),
      ];

      events.sort((a, b) => a.date.getTime() - b.date.getTime());

      return events;
    }),
});
