import { z } from "zod";
import { eq, desc, asc, ilike, and, gte, lte, count, sql, or, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, adminProcedure } from "../trpc";
import {
  creators,
  contacts,
  conversations,
  aiUsageLog,
  aiConfigs,
  adminAuditLog,
  seoConfig,
} from "@/server/db/schema";
import { getStripe } from "@/lib/stripe";
import { PLAN_LIMITS } from "@/server/services/usage-limits";

function maskApiKey(key: string): string {
  if (!key || key.length < 8) return "••••••••";
  return key.slice(0, 4) + "••••••••" + key.slice(-4);
}

// ─── Helper: registrar en audit log ─────────────────────────────────────────

async function auditLog(
  db: any,
  adminId: string,
  targetCreatorId: string | null,
  action: string,
  previousValue?: unknown,
  newValue?: unknown,
  metadata?: Record<string, unknown>
) {
  await db.insert(adminAuditLog).values({
    adminId,
    targetCreatorId,
    action,
    previousValue: previousValue ?? null,
    newValue: newValue ?? null,
    metadata: metadata ?? {},
  });
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const adminRouter = createTRPCRouter({

  // ── Gestión de usuarios ───────────────────────────────────────────────────

  /** Lista paginada de creators con filtros */
  listCreators: adminProcedure
    .input(
      z.object({
        search: z.string().optional(),
        plan: z.enum(["free", "starter", "pro", "business"]).optional(),
        status: z.enum(["active", "past_due", "canceled", "trialing"]).optional(),
        role: z.enum(["creator", "admin"]).optional(),
        orderBy: z.enum(["createdAt", "name", "email"]).default("createdAt"),
        order: z.enum(["asc", "desc"]).default("desc"),
        limit: z.number().min(1).max(100).default(25),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];

      if (input.search) {
        conditions.push(
          or(
            ilike(creators.email, `%${input.search}%`),
            ilike(creators.name, `%${input.search}%`)
          )
        );
      }
      if (input.plan) conditions.push(eq(creators.subscriptionPlan, input.plan));
      if (input.status) conditions.push(eq(creators.subscriptionStatus, input.status));
      if (input.role) conditions.push(eq(creators.role, input.role));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const orderFn = input.order === "asc" ? asc : desc;
      const orderCol =
        input.orderBy === "name"
          ? creators.name
          : input.orderBy === "email"
          ? creators.email
          : creators.createdAt;

      const [rows, [{ total }]] = await Promise.all([
        ctx.db.query.creators.findMany({
          where,
          columns: {
            id: true,
            name: true,
            email: true,
            role: true,
            subscriptionPlan: true,
            subscriptionStatus: true,
            currentPeriodEnd: true,
            onboardingCompleted: true,
            emailVerified: true,
            createdAt: true,
          },
          orderBy: [orderFn(orderCol)],
          limit: input.limit,
          offset: input.offset,
        }),
        ctx.db.select({ total: count() }).from(creators).where(where),
      ]);

      return {
        creators: rows,
        total,
        hasMore: input.offset + input.limit < total,
      };
    }),

  /** Detalle completo de un creator */
  getCreator: adminProcedure
    .input(z.object({ creatorId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const creator = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, input.creatorId),
        columns: {
          id: true,
          name: true,
          email: true,
          role: true,
          emailVerified: true,
          subscriptionPlan: true,
          subscriptionStatus: true,
          stripeCustomerId: true,
          stripeSubscriptionId: true,
          stripePriceId: true,
          currentPeriodEnd: true,
          onboardingCompleted: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!creator) throw new TRPCError({ code: "NOT_FOUND" });

      // Stats básicas
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [[contactCount], [convCount], [aiUsageMonth], [aiUsageTotal]] =
        await Promise.all([
          ctx.db
            .select({ count: count() })
            .from(contacts)
            .where(eq(contacts.creatorId, input.creatorId)),
          ctx.db
            .select({ count: count() })
            .from(conversations)
            .where(eq(conversations.creatorId, input.creatorId)),
          ctx.db
            .select({ count: count(), tokens: sql<number>`sum(${aiUsageLog.tokensUsed})` })
            .from(aiUsageLog)
            .where(
              and(
                eq(aiUsageLog.creatorId, input.creatorId),
                gte(aiUsageLog.createdAt, monthStart)
              )
            ),
          ctx.db
            .select({ count: count(), tokens: sql<number>`sum(${aiUsageLog.tokensUsed})` })
            .from(aiUsageLog)
            .where(eq(aiUsageLog.creatorId, input.creatorId)),
        ]);

      // Historial de acciones admin sobre este creator
      const auditHistory = await ctx.db.query.adminAuditLog.findMany({
        where: eq(adminAuditLog.targetCreatorId, input.creatorId),
        orderBy: [desc(adminAuditLog.createdAt)],
        limit: 20,
        with: {
          admin: { columns: { id: true, name: true, email: true } },
        },
      });

      return {
        ...creator,
        limits: PLAN_LIMITS[creator.subscriptionPlan as keyof typeof PLAN_LIMITS],
        stats: {
          contacts: contactCount?.count ?? 0,
          conversations: convCount?.count ?? 0,
          aiMessagesThisMonth: aiUsageMonth?.count ?? 0,
          aiTokensThisMonth: aiUsageMonth?.tokens ?? 0,
          aiMessagesTotal: aiUsageTotal?.count ?? 0,
          aiTokensTotal: aiUsageTotal?.tokens ?? 0,
        },
        auditHistory,
      };
    }),

  /** Cambiar plan de un creator directamente (sin Stripe) */
  updatePlan: adminProcedure
    .input(
      z.object({
        creatorId: z.string().uuid(),
        plan: z.enum(["free", "starter", "pro", "business"]),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const creator = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, input.creatorId),
        columns: { id: true, subscriptionPlan: true, subscriptionStatus: true },
      });
      if (!creator) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.db
        .update(creators)
        .set({
          subscriptionPlan: input.plan,
          subscriptionStatus: "active",
          updatedAt: new Date(),
        })
        .where(eq(creators.id, input.creatorId));

      await auditLog(
        ctx.db,
        ctx.creatorId,
        input.creatorId,
        "plan_changed",
        { plan: creator.subscriptionPlan, status: creator.subscriptionStatus },
        { plan: input.plan, status: "active" },
        { reason: input.reason }
      );

      return { success: true };
    }),

  /** Suspender o reactivar una cuenta */
  updateStatus: adminProcedure
    .input(
      z.object({
        creatorId: z.string().uuid(),
        status: z.enum(["active", "past_due", "canceled", "trialing"]),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const creator = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, input.creatorId),
        columns: { id: true, subscriptionStatus: true },
      });
      if (!creator) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.db
        .update(creators)
        .set({ subscriptionStatus: input.status, updatedAt: new Date() })
        .where(eq(creators.id, input.creatorId));

      await auditLog(
        ctx.db,
        ctx.creatorId,
        input.creatorId,
        "status_changed",
        { status: creator.subscriptionStatus },
        { status: input.status },
        { reason: input.reason }
      );

      return { success: true };
    }),

  /** Promover a admin o revocar rol */
  updateRole: adminProcedure
    .input(
      z.object({
        creatorId: z.string().uuid(),
        role: z.enum(["creator", "admin"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // No puede modificar su propio rol
      if (input.creatorId === ctx.creatorId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No puedes modificar tu propio rol.",
        });
      }

      const creator = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, input.creatorId),
        columns: { id: true, role: true, name: true },
      });
      if (!creator) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.db
        .update(creators)
        .set({ role: input.role, updatedAt: new Date() })
        .where(eq(creators.id, input.creatorId));

      await auditLog(
        ctx.db,
        ctx.creatorId,
        input.creatorId,
        "role_changed",
        { role: creator.role },
        { role: input.role }
      );

      return { success: true };
    }),

  /** Resetear onboarding de un creator */
  resetOnboarding: adminProcedure
    .input(z.object({ creatorId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const creator = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, input.creatorId),
        columns: { id: true },
      });
      if (!creator) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.db
        .update(creators)
        .set({ onboardingCompleted: false, updatedAt: new Date() })
        .where(eq(creators.id, input.creatorId));

      await auditLog(ctx.db, ctx.creatorId, input.creatorId, "onboarding_reset");

      return { success: true };
    }),

  /** Eliminar cuenta (cancela Stripe si tiene suscripción activa) */
  deleteCreator: adminProcedure
    .input(
      z.object({
        creatorId: z.string().uuid(),
        confirmation: z.literal("ELIMINAR"),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.creatorId === ctx.creatorId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No puedes eliminar tu propia cuenta.",
        });
      }

      const creator = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, input.creatorId),
        columns: {
          id: true,
          email: true,
          name: true,
          stripeSubscriptionId: true,
          subscriptionPlan: true,
        },
      });
      if (!creator) throw new TRPCError({ code: "NOT_FOUND" });

      // Cancelar suscripción Stripe si existe
      if (creator.stripeSubscriptionId) {
        try {
          await getStripe().subscriptions.cancel(creator.stripeSubscriptionId);
        } catch {
          // No bloqueamos si Stripe falla
        }
      }

      await auditLog(
        ctx.db,
        ctx.creatorId,
        null, // el creator ya no existirá
        "creator_deleted",
        { id: creator.id, email: creator.email, plan: creator.subscriptionPlan },
        null,
        { reason: input.reason }
      );

      // Cascade deletes eliminan todo lo relacionado
      await ctx.db.delete(creators).where(eq(creators.id, input.creatorId));

      return { success: true };
    }),

  // ── Gestión de suscripciones ──────────────────────────────────────────────

  /** Sincronizar plan/estado desde Stripe */
  syncStripeSubscription: adminProcedure
    .input(z.object({ creatorId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const creator = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, input.creatorId),
        columns: {
          id: true,
          stripeSubscriptionId: true,
          subscriptionPlan: true,
          subscriptionStatus: true,
        },
      });
      if (!creator) throw new TRPCError({ code: "NOT_FOUND" });
      if (!creator.stripeSubscriptionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Este creator no tiene suscripción de Stripe.",
        });
      }

      const sub = await getStripe().subscriptions.retrieve(
        creator.stripeSubscriptionId
      );
      const priceId = sub.items.data[0]?.price.id;
      const periodEnd = sub.items.data[0]?.current_period_end;

      const statusMap: Record<string, string> = {
        active: "active",
        past_due: "past_due",
        canceled: "canceled",
        trialing: "trialing",
        incomplete: "active",
        incomplete_expired: "canceled",
        unpaid: "past_due",
        paused: "active",
      };

      await ctx.db
        .update(creators)
        .set({
          subscriptionStatus: (statusMap[sub.status] ?? "active") as any,
          stripePriceId: priceId,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
          updatedAt: new Date(),
        })
        .where(eq(creators.id, input.creatorId));

      await auditLog(
        ctx.db,
        ctx.creatorId,
        input.creatorId,
        "stripe_synced",
        { plan: creator.subscriptionPlan, status: creator.subscriptionStatus },
        { status: statusMap[sub.status], priceId }
      );

      return { success: true, stripeStatus: sub.status };
    }),

  /** Extender prueba / dar días gratuitos */
  extendTrial: adminProcedure
    .input(
      z.object({
        creatorId: z.string().uuid(),
        days: z.number().min(1).max(365),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const creator = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, input.creatorId),
        columns: { id: true, currentPeriodEnd: true },
      });
      if (!creator) throw new TRPCError({ code: "NOT_FOUND" });

      const base = creator.currentPeriodEnd ?? new Date();
      const newEnd = new Date(base);
      newEnd.setDate(newEnd.getDate() + input.days);

      await ctx.db
        .update(creators)
        .set({
          currentPeriodEnd: newEnd,
          subscriptionStatus: "active",
          updatedAt: new Date(),
        })
        .where(eq(creators.id, input.creatorId));

      await auditLog(
        ctx.db,
        ctx.creatorId,
        input.creatorId,
        "trial_extended",
        { currentPeriodEnd: creator.currentPeriodEnd },
        { currentPeriodEnd: newEnd, days: input.days },
        { reason: input.reason }
      );

      return { success: true, newPeriodEnd: newEnd };
    }),

  // ── Gestión de IA ─────────────────────────────────────────────────────────

  /** Ver configuración IA de un creator (key enmascarada) */
  getCreatorAIConfig: adminProcedure
    .input(z.object({ creatorId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const config = await ctx.db.query.aiConfigs.findFirst({
        where: eq(aiConfigs.creatorId, input.creatorId),
        columns: {
          id: true,
          provider: true,
          model: true,
          apiKey: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!config) return null;

      return {
        ...config,
        apiKey: maskApiKey(config.apiKey),
      };
    }),

  /** Forzar configuración IA a un creator */
  setCreatorAIConfig: adminProcedure
    .input(
      z.object({
        creatorId: z.string().uuid(),
        provider: z.enum(["anthropic", "openai", "google", "minimax", "kimi"]),
        model: z.string().min(1),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const creator = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, input.creatorId),
        columns: { id: true },
      });
      if (!creator) throw new TRPCError({ code: "NOT_FOUND" });

      const existing = await ctx.db.query.aiConfigs.findFirst({
        where: eq(aiConfigs.creatorId, input.creatorId),
        columns: { provider: true, model: true },
      });

      await ctx.db
        .update(aiConfigs)
        .set({
          provider: input.provider,
          model: input.model,
          updatedAt: new Date(),
        })
        .where(eq(aiConfigs.creatorId, input.creatorId));

      await auditLog(
        ctx.db,
        ctx.creatorId,
        input.creatorId,
        "ai_config_changed",
        existing ? { provider: existing.provider, model: existing.model } : null,
        { provider: input.provider, model: input.model },
        { reason: input.reason }
      );

      return { success: true };
    }),

  // ── Métricas globales ─────────────────────────────────────────────────────

  /** KPIs globales del sistema */
  getGlobalStats: adminProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const [
      [totalCreators],
      [newThisMonth],
      [newLastMonth],
      planDistribution,
      [totalContacts],
      [aiUsageThisMonth],
    ] = await Promise.all([
      ctx.db.select({ count: count() }).from(creators),
      ctx.db
        .select({ count: count() })
        .from(creators)
        .where(gte(creators.createdAt, monthStart)),
      ctx.db
        .select({ count: count() })
        .from(creators)
        .where(
          and(
            gte(creators.createdAt, lastMonthStart),
            lte(creators.createdAt, lastMonthEnd)
          )
        ),
      ctx.db
        .select({
          plan: creators.subscriptionPlan,
          count: count(),
        })
        .from(creators)
        .groupBy(creators.subscriptionPlan),
      ctx.db.select({ count: count() }).from(contacts),
      ctx.db
        .select({
          count: count(),
          tokens: sql<number>`coalesce(sum(${aiUsageLog.tokensUsed}), 0)`,
        })
        .from(aiUsageLog)
        .where(gte(aiUsageLog.createdAt, monthStart)),
    ]);

    // MRR calculado por plan
    const PLAN_PRICES = { free: 0, starter: 15, pro: 29, business: 0 };
    const mrr = planDistribution.reduce((sum, row) => {
      const price = PLAN_PRICES[row.plan as keyof typeof PLAN_PRICES] ?? 0;
      return sum + price * row.count;
    }, 0);

    const planMap = Object.fromEntries(
      planDistribution.map((r) => [r.plan, r.count])
    );

    return {
      totalCreators: totalCreators?.count ?? 0,
      newThisMonth: newThisMonth?.count ?? 0,
      newLastMonth: newLastMonth?.count ?? 0,
      totalContacts: totalContacts?.count ?? 0,
      mrr,
      planDistribution: {
        free: planMap.free ?? 0,
        starter: planMap.starter ?? 0,
        pro: planMap.pro ?? 0,
        business: planMap.business ?? 0,
      },
      aiUsageThisMonth: {
        requests: aiUsageThisMonth?.count ?? 0,
        tokens: aiUsageThisMonth?.tokens ?? 0,
      },
    };
  }),

  /** Creators con mayor actividad */
  getTopActiveCreators: adminProcedure
    .input(
      z.object({
        metric: z.enum(["ai_requests", "contacts", "conversations"]).default("ai_requests"),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      if (input.metric === "ai_requests") {
        return ctx.db
          .select({
            creatorId: aiUsageLog.creatorId,
            name: creators.name,
            email: creators.email,
            plan: creators.subscriptionPlan,
            value: count(),
          })
          .from(aiUsageLog)
          .innerJoin(creators, eq(creators.id, aiUsageLog.creatorId))
          .where(gte(aiUsageLog.createdAt, monthStart))
          .groupBy(aiUsageLog.creatorId, creators.name, creators.email, creators.subscriptionPlan)
          .orderBy(desc(count()))
          .limit(input.limit);
      }

      if (input.metric === "contacts") {
        return ctx.db
          .select({
            creatorId: contacts.creatorId,
            name: creators.name,
            email: creators.email,
            plan: creators.subscriptionPlan,
            value: count(),
          })
          .from(contacts)
          .innerJoin(creators, eq(creators.id, contacts.creatorId))
          .groupBy(contacts.creatorId, creators.name, creators.email, creators.subscriptionPlan)
          .orderBy(desc(count()))
          .limit(input.limit);
      }

      // conversations
      return ctx.db
        .select({
          creatorId: conversations.creatorId,
          name: creators.name,
          email: creators.email,
          plan: creators.subscriptionPlan,
          value: count(),
        })
        .from(conversations)
        .innerJoin(creators, eq(creators.id, conversations.creatorId))
        .groupBy(conversations.creatorId, creators.name, creators.email, creators.subscriptionPlan)
        .orderBy(desc(count()))
        .limit(input.limit);
    }),

  /** Creators en riesgo de churn (past_due o inactivos) */
  getChurnRisk: adminProcedure.query(async ({ ctx }) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // past_due
    const pastDue = await ctx.db.query.creators.findMany({
      where: and(
        eq(creators.subscriptionStatus, "past_due"),
        ne(creators.subscriptionPlan, "free")
      ),
      columns: {
        id: true,
        name: true,
        email: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        currentPeriodEnd: true,
        updatedAt: true,
      },
      orderBy: [asc(creators.updatedAt)],
      limit: 50,
    });

    return { pastDue };
  }),

  /** Uso global de IA por día (últimos 30 días) */
  getAIUsageGlobal: adminProcedure.query(async ({ ctx }) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [byDay, byProvider, byType] = await Promise.all([
      ctx.db
        .select({
          day: sql<string>`date_trunc('day', ${aiUsageLog.createdAt})::date`,
          requests: count(),
          tokens: sql<number>`coalesce(sum(${aiUsageLog.tokensUsed}), 0)`,
        })
        .from(aiUsageLog)
        .where(gte(aiUsageLog.createdAt, thirtyDaysAgo))
        .groupBy(sql`date_trunc('day', ${aiUsageLog.createdAt})::date`)
        .orderBy(sql`date_trunc('day', ${aiUsageLog.createdAt})::date`),

      ctx.db
        .select({
          model: aiUsageLog.modelUsed,
          requests: count(),
          tokens: sql<number>`coalesce(sum(${aiUsageLog.tokensUsed}), 0)`,
        })
        .from(aiUsageLog)
        .where(gte(aiUsageLog.createdAt, thirtyDaysAgo))
        .groupBy(aiUsageLog.modelUsed)
        .orderBy(desc(count())),

      ctx.db
        .select({
          type: aiUsageLog.requestType,
          requests: count(),
        })
        .from(aiUsageLog)
        .where(gte(aiUsageLog.createdAt, thirtyDaysAgo))
        .groupBy(aiUsageLog.requestType),
    ]);

    return { byDay, byProvider, byType };
  }),

  /** Historial del audit log (acciones de todos los admins) */
  getAuditLog: adminProcedure
    .input(
      z.object({
        action: z.string().optional(),
        adminId: z.string().uuid().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];
      if (input.action) conditions.push(eq(adminAuditLog.action, input.action));
      if (input.adminId) conditions.push(eq(adminAuditLog.adminId, input.adminId));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, [{ total }]] = await Promise.all([
        ctx.db.query.adminAuditLog.findMany({
          where,
          with: {
            admin: { columns: { id: true, name: true, email: true } },
            targetCreator: { columns: { id: true, name: true, email: true } },
          },
          orderBy: [desc(adminAuditLog.createdAt)],
          limit: input.limit,
          offset: input.offset,
        }),
        ctx.db.select({ total: count() }).from(adminAuditLog).where(where),
      ]);

      return { logs: rows, total };
    }),

  getSeoConfig: adminProcedure.query(async ({ ctx }) => {
    const config = await ctx.db.query.seoConfig.findFirst({
      where: eq(seoConfig.id, "global"),
    });
    return config ?? null;
  }),

  updateSeoConfig: adminProcedure
    .input(z.object({
      siteTitle: z.string().min(1).max(255),
      siteDescription: z.string().min(1),
      keywords: z.string().optional(),
      canonicalUrl: z.string().url().optional().or(z.literal("")),
      ogTitle: z.string().max(255).optional(),
      ogDescription: z.string().optional(),
      ogImageUrl: z.string().url().optional().or(z.literal("")),
      twitterTitle: z.string().max(255).optional(),
      twitterDescription: z.string().optional(),
      twitterImageUrl: z.string().url().optional().or(z.literal("")),
      faviconUrl: z.string().url().optional().or(z.literal("")),
      robotsIndex: z.boolean(),
      robotsFollow: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(seoConfig)
        .values({ id: "global", ...input, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: seoConfig.id,
          set: { ...input, updatedAt: new Date() },
        });

      await auditLog(ctx.db, ctx.creatorId, null, "seo_config_updated", null, input);
      return { success: true };
    }),
});
