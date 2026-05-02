import { z } from "zod";
import { eq, and, gte, lte, desc, sql, count } from "drizzle-orm";
import { createTRPCRouter, managerProcedure } from "../trpc";
import { teamAuditLog, creators } from "@/server/db/schema";

export const auditLogRouter = createTRPCRouter({
  list: managerProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(10).max(100).default(50),
        userId: z.string().uuid().optional(),
        action: z.string().max(100).optional(),
        entityType: z.string().max(50).optional(),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(teamAuditLog.creatorId, ctx.creatorId)];

      if (input.userId) {
        conditions.push(eq(teamAuditLog.userId, input.userId));
      }
      if (input.action) {
        conditions.push(eq(teamAuditLog.action, input.action));
      }
      if (input.entityType) {
        conditions.push(eq(teamAuditLog.entityType, input.entityType));
      }
      if (input.dateFrom) {
        conditions.push(gte(teamAuditLog.createdAt, input.dateFrom));
      }
      if (input.dateTo) {
        conditions.push(lte(teamAuditLog.createdAt, input.dateTo));
      }

      const whereClause = and(...conditions);

      const [items, totalResult] = await Promise.all([
        ctx.db
          .select({
            id: teamAuditLog.id,
            userId: teamAuditLog.userId,
            userName: teamAuditLog.userName,
            action: teamAuditLog.action,
            entityType: teamAuditLog.entityType,
            entityId: teamAuditLog.entityId,
            details: teamAuditLog.details,
            createdAt: teamAuditLog.createdAt,
          })
          .from(teamAuditLog)
          .where(whereClause)
          .orderBy(desc(teamAuditLog.createdAt))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),
        ctx.db
          .select({ total: count() })
          .from(teamAuditLog)
          .where(whereClause),
      ]);

      const total = totalResult[0]?.total ?? 0;

      return {
        items,
        total,
        hasMore: input.page * input.pageSize < total,
      };
    }),

  getActionTypes: managerProcedure.query(async ({ ctx }) => {
    const result = await ctx.db
      .selectDistinct({ action: teamAuditLog.action })
      .from(teamAuditLog)
      .where(eq(teamAuditLog.creatorId, ctx.creatorId))
      .orderBy(teamAuditLog.action);

    return result.map((r) => r.action);
  }),

  getActiveUsers: managerProcedure.query(async ({ ctx }) => {
    const result = await ctx.db
      .selectDistinct({
        userId: teamAuditLog.userId,
        userName: teamAuditLog.userName,
      })
      .from(teamAuditLog)
      .where(eq(teamAuditLog.creatorId, ctx.creatorId))
      .orderBy(teamAuditLog.userName);

    return result;
  }),
});
