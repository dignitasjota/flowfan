import { z } from "zod";
import { eq, and, gte, lte, sql, desc, count, sum } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { fanTransactions, contacts, contactProfiles, messages, conversations } from "@/server/db/schema";
import { checkRevenueAccess } from "@/server/services/usage-limits";

export const revenueRouter = createTRPCRouter({
  // Registrar transacción
  create: protectedProcedure
    .input(
      z.object({
        contactId: z.string().uuid(),
        type: z.enum(["tip", "ppv", "subscription", "custom"]),
        amount: z.number().positive("El monto debe ser positivo"),
        description: z.string().optional(),
        transactionDate: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkRevenueAccess(ctx.db, ctx.creatorId, "basic");

      // Verificar que el contacto pertenece al creator
      const contact = await ctx.db.query.contacts.findFirst({
        where: and(
          eq(contacts.id, input.contactId),
          eq(contacts.creatorId, ctx.creatorId)
        ),
        columns: { id: true },
      });

      if (!contact) {
        throw new Error("Contacto no encontrado");
      }

      const amountCents = Math.round(input.amount * 100);

      const [tx] = await ctx.db
        .insert(fanTransactions)
        .values({
          creatorId: ctx.creatorId,
          contactId: input.contactId,
          type: input.type,
          amount: amountCents,
          description: input.description,
          transactionDate: input.transactionDate ?? new Date(),
        })
        .returning();

      return tx;
    }),

  // Editar transacción
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        type: z.enum(["tip", "ppv", "subscription", "custom"]).optional(),
        amount: z.number().positive().optional(),
        description: z.string().optional(),
        transactionDate: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkRevenueAccess(ctx.db, ctx.creatorId, "basic");

      const existing = await ctx.db.query.fanTransactions.findFirst({
        where: and(
          eq(fanTransactions.id, input.id),
          eq(fanTransactions.creatorId, ctx.creatorId)
        ),
      });

      if (!existing) {
        throw new Error("Transacción no encontrada");
      }

      const updates: Record<string, unknown> = {};
      if (input.type) updates.type = input.type;
      if (input.amount) updates.amount = Math.round(input.amount * 100);
      if (input.description !== undefined) updates.description = input.description;
      if (input.transactionDate) updates.transactionDate = input.transactionDate;

      const [updated] = await ctx.db
        .update(fanTransactions)
        .set(updates)
        .where(eq(fanTransactions.id, input.id))
        .returning();

      return updated;
    }),

  // Eliminar transacción
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await checkRevenueAccess(ctx.db, ctx.creatorId, "basic");

      await ctx.db
        .delete(fanTransactions)
        .where(
          and(
            eq(fanTransactions.id, input.id),
            eq(fanTransactions.creatorId, ctx.creatorId)
          )
        );

      return { success: true };
    }),

  // Transacciones de un contacto
  listByContact: protectedProcedure
    .input(
      z.object({
        contactId: z.string().uuid(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      await checkRevenueAccess(ctx.db, ctx.creatorId, "basic");

      const rows = await ctx.db
        .select()
        .from(fanTransactions)
        .where(
          and(
            eq(fanTransactions.creatorId, ctx.creatorId),
            eq(fanTransactions.contactId, input.contactId)
          )
        )
        .orderBy(desc(fanTransactions.transactionDate))
        .limit(input.limit)
        .offset(input.offset);

      return rows.map((r) => ({
        ...r,
        amountEur: r.amount / 100,
      }));
    }),

  // Resumen de revenue por contacto
  getContactSummary: protectedProcedure
    .input(z.object({ contactId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await checkRevenueAccess(ctx.db, ctx.creatorId, "basic");

      const [totals] = await ctx.db
        .select({
          total: sum(fanTransactions.amount),
          count: count(),
        })
        .from(fanTransactions)
        .where(
          and(
            eq(fanTransactions.creatorId, ctx.creatorId),
            eq(fanTransactions.contactId, input.contactId)
          )
        );

      // Por tipo
      const byType = await ctx.db
        .select({
          type: fanTransactions.type,
          total: sum(fanTransactions.amount),
          count: count(),
        })
        .from(fanTransactions)
        .where(
          and(
            eq(fanTransactions.creatorId, ctx.creatorId),
            eq(fanTransactions.contactId, input.contactId)
          )
        )
        .groupBy(fanTransactions.type);

      return {
        totalEur: Number(totals?.total ?? 0) / 100,
        transactionCount: totals?.count ?? 0,
        byType: byType.map((t) => ({
          type: t.type,
          totalEur: Number(t.total ?? 0) / 100,
          count: t.count,
        })),
      };
    }),

  // Dashboard stats de revenue
  getDashboardStats: protectedProcedure.query(async ({ ctx }) => {
    await checkRevenueAccess(ctx.db, ctx.creatorId, "full");

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // Total
    const [total] = await ctx.db
      .select({ total: sum(fanTransactions.amount), count: count() })
      .from(fanTransactions)
      .where(eq(fanTransactions.creatorId, ctx.creatorId));

    // Este mes
    const [thisMonth] = await ctx.db
      .select({ total: sum(fanTransactions.amount), count: count() })
      .from(fanTransactions)
      .where(
        and(
          eq(fanTransactions.creatorId, ctx.creatorId),
          gte(fanTransactions.transactionDate, thisMonthStart)
        )
      );

    // Mes anterior
    const [lastMonth] = await ctx.db
      .select({ total: sum(fanTransactions.amount) })
      .from(fanTransactions)
      .where(
        and(
          eq(fanTransactions.creatorId, ctx.creatorId),
          gte(fanTransactions.transactionDate, lastMonthStart),
          lte(fanTransactions.transactionDate, thisMonthStart)
        )
      );

    // Por tipo
    const byType = await ctx.db
      .select({
        type: fanTransactions.type,
        total: sum(fanTransactions.amount),
      })
      .from(fanTransactions)
      .where(eq(fanTransactions.creatorId, ctx.creatorId))
      .groupBy(fanTransactions.type);

    const thisMonthAmount = Number(thisMonth?.total ?? 0) / 100;
    const lastMonthAmount = Number(lastMonth?.total ?? 0) / 100;
    const growth =
      lastMonthAmount > 0
        ? Math.round(((thisMonthAmount - lastMonthAmount) / lastMonthAmount) * 100)
        : thisMonthAmount > 0
          ? 100
          : 0;

    return {
      totalRevenueEur: Number(total?.total ?? 0) / 100,
      transactionCount: total?.count ?? 0,
      thisMonthEur: thisMonthAmount,
      lastMonthEur: lastMonthAmount,
      growthPercent: growth,
      avgTransactionEur:
        (total?.count ?? 0) > 0
          ? Number(total?.total ?? 0) / 100 / (total?.count ?? 1)
          : 0,
      byType: byType.map((t) => ({
        type: t.type,
        totalEur: Number(t.total ?? 0) / 100,
      })),
    };
  }),

  // Tendencia temporal
  getRevenueTrend: protectedProcedure
    .input(
      z.object({
        period: z.enum(["daily", "weekly", "monthly"]).default("daily"),
        from: z.date().optional(),
        to: z.date().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await checkRevenueAccess(ctx.db, ctx.creatorId, "full");

      const truncFn =
        input.period === "daily"
          ? "day"
          : input.period === "weekly"
            ? "week"
            : "month";

      const conditions = [eq(fanTransactions.creatorId, ctx.creatorId)];
      if (input.from) conditions.push(gte(fanTransactions.transactionDate, input.from));
      if (input.to) conditions.push(lte(fanTransactions.transactionDate, input.to));

      const rows = await ctx.db
        .select({
          date: sql<string>`date_trunc(${sql.raw(`'${truncFn}'`)}, ${fanTransactions.transactionDate})::date`,
          total: sum(fanTransactions.amount),
          count: count(),
        })
        .from(fanTransactions)
        .where(and(...conditions))
        .groupBy(sql`date_trunc(${sql.raw(`'${truncFn}'`)}, ${fanTransactions.transactionDate})::date`)
        .orderBy(sql`date_trunc(${sql.raw(`'${truncFn}'`)}, ${fanTransactions.transactionDate})::date`);

      return rows.map((r) => ({
        date: r.date,
        totalEur: Number(r.total ?? 0) / 100,
        count: r.count,
      }));
    }),

  // Top spenders
  getTopSpenders: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      await checkRevenueAccess(ctx.db, ctx.creatorId, "full");

      const rows = await ctx.db
        .select({
          contactId: fanTransactions.contactId,
          username: contacts.username,
          displayName: contacts.displayName,
          platformType: contacts.platformType,
          totalRevenue: sum(fanTransactions.amount),
          transactionCount: count(),
          funnelStage: contactProfiles.funnelStage,
          paymentProbability: contactProfiles.paymentProbability,
        })
        .from(fanTransactions)
        .innerJoin(contacts, eq(fanTransactions.contactId, contacts.id))
        .leftJoin(contactProfiles, eq(contacts.id, contactProfiles.contactId))
        .where(eq(fanTransactions.creatorId, ctx.creatorId))
        .groupBy(
          fanTransactions.contactId,
          contacts.username,
          contacts.displayName,
          contacts.platformType,
          contactProfiles.funnelStage,
          contactProfiles.paymentProbability
        )
        .orderBy(desc(sum(fanTransactions.amount)))
        .limit(input.limit);

      return rows.map((r) => ({
        contactId: r.contactId,
        username: r.username,
        displayName: r.displayName,
        platformType: r.platformType,
        totalRevenueEur: Number(r.totalRevenue ?? 0) / 100,
        transactionCount: r.transactionCount,
        funnelStage: r.funnelStage,
        paymentProbability: r.paymentProbability,
      }));
    }),

  // ROI por contacto
  getContactROI: protectedProcedure
    .input(z.object({ contactId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await checkRevenueAccess(ctx.db, ctx.creatorId, "full");

      // Revenue total
      const [revResult] = await ctx.db
        .select({ total: sum(fanTransactions.amount) })
        .from(fanTransactions)
        .where(
          and(
            eq(fanTransactions.creatorId, ctx.creatorId),
            eq(fanTransactions.contactId, input.contactId)
          )
        );

      // Mensajes del creator en las conversaciones de este contacto
      const [msgResult] = await ctx.db
        .select({ count: count() })
        .from(messages)
        .innerJoin(conversations, eq(messages.conversationId, conversations.id))
        .where(
          and(
            eq(conversations.creatorId, ctx.creatorId),
            eq(conversations.contactId, input.contactId),
            eq(messages.role, "creator")
          )
        );

      const totalRevenue = Number(revResult?.total ?? 0) / 100;
      const totalMessages = msgResult?.count ?? 0;
      const estimatedMinutes = totalMessages * 2; // ~2 min por mensaje
      const estimatedHours = estimatedMinutes / 60;

      return {
        totalRevenueEur: totalRevenue,
        totalCreatorMessages: totalMessages,
        revenuePerMessage: totalMessages > 0 ? totalRevenue / totalMessages : 0,
        estimatedMinutes,
        revenuePerHour: estimatedHours > 0 ? totalRevenue / estimatedHours : 0,
      };
    }),

  // Ranking ROI
  getROIRanking: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ ctx, input }) => {
      await checkRevenueAccess(ctx.db, ctx.creatorId, "full");

      // Revenue por contacto
      const revenueByContact = await ctx.db
        .select({
          contactId: fanTransactions.contactId,
          totalRevenue: sum(fanTransactions.amount),
        })
        .from(fanTransactions)
        .where(eq(fanTransactions.creatorId, ctx.creatorId))
        .groupBy(fanTransactions.contactId);

      if (revenueByContact.length === 0) return [];

      // Mensajes del creator por contacto
      const messagesByContact = await ctx.db
        .select({
          contactId: conversations.contactId,
          count: count(),
        })
        .from(messages)
        .innerJoin(conversations, eq(messages.conversationId, conversations.id))
        .where(
          and(
            eq(conversations.creatorId, ctx.creatorId),
            eq(messages.role, "creator")
          )
        )
        .groupBy(conversations.contactId);

      const msgMap = new Map(messagesByContact.map((m) => [m.contactId, m.count]));

      // Contactos info
      const contactIds = revenueByContact.map((r) => r.contactId);
      const contactsList = await ctx.db.query.contacts.findMany({
        where: and(
          eq(contacts.creatorId, ctx.creatorId),
          sql`${contacts.id} = ANY(${contactIds})`
        ),
        columns: { id: true, username: true, displayName: true, platformType: true },
      });
      const contactMap = new Map(contactsList.map((c) => [c.id, c]));

      const results = revenueByContact
        .map((r) => {
          const rev = Number(r.totalRevenue ?? 0) / 100;
          const msgs = msgMap.get(r.contactId) ?? 0;
          const hours = (msgs * 2) / 60;
          const contact = contactMap.get(r.contactId);
          return {
            contactId: r.contactId,
            username: contact?.username ?? "—",
            displayName: contact?.displayName,
            platformType: contact?.platformType,
            totalRevenueEur: rev,
            totalMessages: msgs,
            revenuePerHour: hours > 0 ? rev / hours : 0,
          };
        })
        .sort((a, b) => b.revenuePerHour - a.revenuePerHour)
        .slice(0, input.limit);

      return results;
    }),

  // Exportar revenue
  exportRevenue: protectedProcedure
    .input(
      z.object({
        format: z.enum(["csv", "json"]),
        from: z.date().optional(),
        to: z.date().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await checkRevenueAccess(ctx.db, ctx.creatorId, "full_export");

      const conditions = [eq(fanTransactions.creatorId, ctx.creatorId)];
      if (input.from) conditions.push(gte(fanTransactions.transactionDate, input.from));
      if (input.to) conditions.push(lte(fanTransactions.transactionDate, input.to));

      const rows = await ctx.db
        .select({
          date: fanTransactions.transactionDate,
          type: fanTransactions.type,
          amount: fanTransactions.amount,
          description: fanTransactions.description,
          username: contacts.username,
          displayName: contacts.displayName,
          platformType: contacts.platformType,
        })
        .from(fanTransactions)
        .innerJoin(contacts, eq(fanTransactions.contactId, contacts.id))
        .where(and(...conditions))
        .orderBy(desc(fanTransactions.transactionDate));

      const data = rows.map((r) => ({
        fecha: r.date.toISOString().split("T")[0],
        tipo: r.type,
        monto_eur: (r.amount / 100).toFixed(2),
        descripcion: r.description ?? "",
        contacto: r.displayName ?? r.username,
        plataforma: r.platformType,
      }));

      if (input.format === "json") {
        return { format: "json" as const, data };
      }

      // CSV
      const headers = ["fecha", "tipo", "monto_eur", "descripcion", "contacto", "plataforma"];
      const csvRows = [
        headers.join(","),
        ...data.map((d) =>
          headers.map((h) => `"${String(d[h as keyof typeof d]).replace(/"/g, '""')}"`).join(",")
        ),
      ];

      return { format: "csv" as const, data: csvRows.join("\n") };
    }),
});
