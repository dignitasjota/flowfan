import { z } from "zod";
import { eq, and, desc, count, sql } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { workflows, workflowExecutions, contacts } from "@/server/db/schema";
import { checkWorkflowLimit } from "@/server/services/usage-limits";

const triggerTypeSchema = z.enum([
  "no_response_timeout",
  "funnel_stage_change",
  "sentiment_change",
  "keyword_detected",
  "new_contact",
]);

const actionTypeSchema = z.enum([
  "send_message",
  "send_template",
  "create_notification",
  "change_tags",
]);

export const workflowsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        triggerType: triggerTypeSchema.optional(),
        isActive: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(workflows.creatorId, ctx.creatorId)];

      if (input.triggerType) {
        conditions.push(eq(workflows.triggerType, input.triggerType));
      }
      if (input.isActive !== undefined) {
        conditions.push(eq(workflows.isActive, input.isActive));
      }

      return ctx.db.query.workflows.findMany({
        where: and(...conditions),
        orderBy: (w, { desc }) => [desc(w.createdAt)],
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.workflows.findFirst({
        where: and(
          eq(workflows.id, input.id),
          eq(workflows.creatorId, ctx.creatorId)
        ),
        with: {
          executions: {
            limit: 10,
            orderBy: (e, { desc }) => [desc(e.executedAt)],
            with: {
              contact: {
                columns: {
                  id: true,
                  username: true,
                  displayName: true,
                },
              },
            },
          },
        },
      }) ?? null;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        triggerType: triggerTypeSchema,
        triggerConfig: z.record(z.unknown()),
        conditions: z.array(
          z.object({
            field: z.string(),
            operator: z.string(),
            value: z.unknown(),
          })
        ),
        actionType: actionTypeSchema,
        actionConfig: z.record(z.unknown()),
        cooldownMinutes: z.number().min(1).default(60),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkWorkflowLimit(ctx.db, ctx.creatorId);

      const [created] = await ctx.db
        .insert(workflows)
        .values({
          creatorId: ctx.creatorId,
          name: input.name,
          description: input.description,
          triggerType: input.triggerType,
          triggerConfig: input.triggerConfig,
          conditions: input.conditions,
          actionType: input.actionType,
          actionConfig: input.actionConfig,
          cooldownMinutes: input.cooldownMinutes,
        })
        .returning();

      return created;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        triggerType: triggerTypeSchema.optional(),
        triggerConfig: z.record(z.unknown()).optional(),
        conditions: z
          .array(
            z.object({
              field: z.string(),
              operator: z.string(),
              value: z.unknown(),
            })
          )
          .optional(),
        actionType: actionTypeSchema.optional(),
        actionConfig: z.record(z.unknown()).optional(),
        cooldownMinutes: z.number().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;

      const updates: Record<string, unknown> = { updatedAt: new Date() };

      if (fields.name !== undefined) updates.name = fields.name;
      if (fields.description !== undefined) updates.description = fields.description;
      if (fields.triggerType !== undefined) updates.triggerType = fields.triggerType;
      if (fields.triggerConfig !== undefined) updates.triggerConfig = fields.triggerConfig;
      if (fields.conditions !== undefined) updates.conditions = fields.conditions;
      if (fields.actionType !== undefined) updates.actionType = fields.actionType;
      if (fields.actionConfig !== undefined) updates.actionConfig = fields.actionConfig;
      if (fields.cooldownMinutes !== undefined) updates.cooldownMinutes = fields.cooldownMinutes;

      const [updated] = await ctx.db
        .update(workflows)
        .set(updates)
        .where(
          and(eq(workflows.id, id), eq(workflows.creatorId, ctx.creatorId))
        )
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(workflows)
        .where(
          and(
            eq(workflows.id, input.id),
            eq(workflows.creatorId, ctx.creatorId)
          )
        );

      return { success: true };
    }),

  toggleActive: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        isActive: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.isActive) {
        await checkWorkflowLimit(ctx.db, ctx.creatorId);
      }

      const [updated] = await ctx.db
        .update(workflows)
        .set({ isActive: input.isActive, updatedAt: new Date() })
        .where(
          and(
            eq(workflows.id, input.id),
            eq(workflows.creatorId, ctx.creatorId)
          )
        )
        .returning();

      return updated;
    }),

  getExecutions: protectedProcedure
    .input(
      z.object({
        workflowId: z.string().uuid().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(workflowExecutions.creatorId, ctx.creatorId)];

      if (input.workflowId) {
        // Verify workflow belongs to creator
        const workflow = await ctx.db.query.workflows.findFirst({
          where: and(
            eq(workflows.id, input.workflowId),
            eq(workflows.creatorId, ctx.creatorId)
          ),
        });

        if (workflow) {
          conditions.push(eq(workflowExecutions.workflowId, input.workflowId));
        }
      }

      const items = await ctx.db
        .select({
          id: workflowExecutions.id,
          workflowId: workflowExecutions.workflowId,
          creatorId: workflowExecutions.creatorId,
          contactId: workflowExecutions.contactId,
          conversationId: workflowExecutions.conversationId,
          triggerData: workflowExecutions.triggerData,
          actionResult: workflowExecutions.actionResult,
          status: workflowExecutions.status,
          errorMessage: workflowExecutions.errorMessage,
          executedAt: workflowExecutions.executedAt,
          contact: {
            id: contacts.id,
            username: contacts.username,
            displayName: contacts.displayName,
          },
        })
        .from(workflowExecutions)
        .leftJoin(contacts, eq(workflowExecutions.contactId, contacts.id))
        .where(and(...conditions))
        .orderBy(desc(workflowExecutions.executedAt))
        .limit(input.limit)
        .offset(input.offset);

      const [totalResult] = await ctx.db
        .select({ total: count() })
        .from(workflowExecutions)
        .where(and(...conditions));

      return {
        items,
        total: totalResult?.total ?? 0,
      };
    }),

  getStats: protectedProcedure.query(async ({ ctx }) => {
    const [totalResult] = await ctx.db
      .select({ total: count() })
      .from(workflows)
      .where(eq(workflows.creatorId, ctx.creatorId));

    const [activeResult] = await ctx.db
      .select({ total: count() })
      .from(workflows)
      .where(
        and(
          eq(workflows.creatorId, ctx.creatorId),
          eq(workflows.isActive, true)
        )
      );

    const [executionsResult] = await ctx.db
      .select({ total: count() })
      .from(workflowExecutions)
      .where(eq(workflowExecutions.creatorId, ctx.creatorId));

    const [successResult] = await ctx.db
      .select({ total: count() })
      .from(workflowExecutions)
      .where(
        and(
          eq(workflowExecutions.creatorId, ctx.creatorId),
          eq(workflowExecutions.status, "success")
        )
      );

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [last7DaysResult] = await ctx.db
      .select({ total: count() })
      .from(workflowExecutions)
      .where(
        and(
          eq(workflowExecutions.creatorId, ctx.creatorId),
          sql`${workflowExecutions.executedAt} >= ${sevenDaysAgo}`
        )
      );

    const totalExecutions = executionsResult?.total ?? 0;
    const successCount = successResult?.total ?? 0;
    const successRate =
      totalExecutions > 0
        ? Math.round((successCount / totalExecutions) * 100)
        : 0;

    return {
      totalWorkflows: totalResult?.total ?? 0,
      activeWorkflows: activeResult?.total ?? 0,
      totalExecutions,
      successRate,
      last7DaysExecutions: last7DaysResult?.total ?? 0,
    };
  }),
});
