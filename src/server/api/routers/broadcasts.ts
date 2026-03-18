import { z } from "zod";
import { eq, and, desc, count } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  broadcasts,
  broadcastRecipients,
  contacts,
  segments,
  platformTypeEnum,
} from "@/server/db/schema";
import {
  checkBroadcastLimit,
  checkBroadcastRecipientLimit,
  checkBroadcastSchedulingAccess,
} from "@/server/services/usage-limits";
import { broadcastProcessingQueue } from "@/server/queues";
import {
  evaluateSegment,
  type SegmentFilter,
} from "@/server/services/segment-evaluator";
import { createChildLogger } from "@/lib/logger";

const logger = createChildLogger("broadcasts-router");

const platformTypeSchema = z.enum(platformTypeEnum.enumValues);

export const broadcastsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.db.query.broadcasts.findMany({
        where: eq(broadcasts.creatorId, ctx.creatorId),
        orderBy: (b, { desc }) => [desc(b.createdAt)],
        limit: input.limit,
        offset: input.offset,
        with: {
          segment: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
      });

      const [totalResult] = await ctx.db
        .select({ total: count() })
        .from(broadcasts)
        .where(eq(broadcasts.creatorId, ctx.creatorId));

      return {
        items,
        total: totalResult?.total ?? 0,
      };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const broadcast = await ctx.db.query.broadcasts.findFirst({
        where: and(
          eq(broadcasts.id, input.id),
          eq(broadcasts.creatorId, ctx.creatorId)
        ),
        with: {
          segment: {
            columns: {
              id: true,
              name: true,
            },
          },
          recipients: {
            limit: 100,
            with: {
              contact: {
                columns: {
                  id: true,
                  username: true,
                  displayName: true,
                  platformType: true,
                },
              },
            },
          },
        },
      });

      return broadcast ?? null;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        content: z.string().min(1),
        segmentId: z.string().uuid(),
        platformType: platformTypeSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkBroadcastLimit(ctx.db, ctx.creatorId);

      const [created] = await ctx.db
        .insert(broadcasts)
        .values({
          creatorId: ctx.creatorId,
          name: input.name,
          content: input.content,
          segmentId: input.segmentId,
          platformType: input.platformType,
          status: "draft",
        })
        .returning();

      return created;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        content: z.string().min(1).optional(),
        segmentId: z.string().uuid().optional(),
        platformType: platformTypeSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;

      const existing = await ctx.db.query.broadcasts.findFirst({
        where: and(
          eq(broadcasts.id, id),
          eq(broadcasts.creatorId, ctx.creatorId)
        ),
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Broadcast no encontrado" });
      }

      if (existing.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Solo se pueden editar broadcasts en estado borrador",
        });
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };

      if (fields.name !== undefined) updates.name = fields.name;
      if (fields.content !== undefined) updates.content = fields.content;
      if (fields.segmentId !== undefined) updates.segmentId = fields.segmentId;
      if (fields.platformType !== undefined) updates.platformType = fields.platformType;

      const [updated] = await ctx.db
        .update(broadcasts)
        .set(updates)
        .where(
          and(eq(broadcasts.id, id), eq(broadcasts.creatorId, ctx.creatorId))
        )
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.broadcasts.findFirst({
        where: and(
          eq(broadcasts.id, input.id),
          eq(broadcasts.creatorId, ctx.creatorId)
        ),
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Broadcast no encontrado" });
      }

      if (existing.status !== "draft" && existing.status !== "cancelled") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Solo se pueden eliminar broadcasts en estado borrador o cancelado",
        });
      }

      await ctx.db
        .delete(broadcasts)
        .where(
          and(
            eq(broadcasts.id, input.id),
            eq(broadcasts.creatorId, ctx.creatorId)
          )
        );

      return { success: true };
    }),

  previewSegment: protectedProcedure
    .input(z.object({ segmentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const segment = await ctx.db.query.segments.findFirst({
        where: and(
          eq(segments.id, input.segmentId),
          eq(segments.creatorId, ctx.creatorId)
        ),
      });

      if (!segment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Segmento no encontrado" });
      }

      const result = await evaluateSegment(ctx.db, ctx.creatorId, {
        filters: segment.filters as SegmentFilter[],
        segmentId: segment.id,
        segmentType: segment.type,
        countOnly: true,
      });

      return { total: result.total, segmentName: segment.name };
    }),

  send: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const broadcast = await ctx.db.query.broadcasts.findFirst({
        where: and(
          eq(broadcasts.id, input.id),
          eq(broadcasts.creatorId, ctx.creatorId)
        ),
      });

      if (!broadcast) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Broadcast no encontrado" });
      }

      if (broadcast.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Solo se pueden enviar broadcasts en estado borrador",
        });
      }

      if (!broadcast.segmentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El broadcast debe tener un segmento asignado",
        });
      }

      const segment = await ctx.db.query.segments.findFirst({
        where: and(
          eq(segments.id, broadcast.segmentId),
          eq(segments.creatorId, ctx.creatorId)
        ),
      });

      if (!segment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Segmento no encontrado" });
      }

      const result = await evaluateSegment(ctx.db, ctx.creatorId, {
        filters: segment.filters as SegmentFilter[],
        segmentId: segment.id,
        segmentType: segment.type,
        countOnly: true,
      });

      await checkBroadcastLimit(ctx.db, ctx.creatorId);
      await checkBroadcastRecipientLimit(ctx.db, ctx.creatorId, result.total);

      const [updated] = await ctx.db
        .update(broadcasts)
        .set({
          status: "processing",
          totalRecipients: result.total,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(broadcasts.id, input.id),
            eq(broadcasts.creatorId, ctx.creatorId)
          )
        )
        .returning();

      await broadcastProcessingQueue.add("process-broadcast", {
        broadcastId: input.id,
        creatorId: ctx.creatorId,
      });

      logger.info({ broadcastId: input.id, totalRecipients: result.total }, "Broadcast enqueued for processing");

      return updated;
    }),

  schedule: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        scheduledAt: z.coerce.date(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkBroadcastSchedulingAccess(ctx.db, ctx.creatorId);

      const broadcast = await ctx.db.query.broadcasts.findFirst({
        where: and(
          eq(broadcasts.id, input.id),
          eq(broadcasts.creatorId, ctx.creatorId)
        ),
      });

      if (!broadcast) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Broadcast no encontrado" });
      }

      if (broadcast.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Solo se pueden programar broadcasts en estado borrador",
        });
      }

      if (input.scheduledAt <= new Date()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La fecha programada debe ser en el futuro",
        });
      }

      const delay = input.scheduledAt.getTime() - Date.now();

      const [updated] = await ctx.db
        .update(broadcasts)
        .set({
          status: "scheduled",
          scheduledAt: input.scheduledAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(broadcasts.id, input.id),
            eq(broadcasts.creatorId, ctx.creatorId)
          )
        )
        .returning();

      await broadcastProcessingQueue.add(
        "process-broadcast",
        {
          broadcastId: input.id,
          creatorId: ctx.creatorId,
        },
        { delay }
      );

      logger.info({ broadcastId: input.id, scheduledAt: input.scheduledAt }, "Broadcast scheduled");

      return updated;
    }),

  cancel: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.broadcasts.findFirst({
        where: and(
          eq(broadcasts.id, input.id),
          eq(broadcasts.creatorId, ctx.creatorId)
        ),
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Broadcast no encontrado" });
      }

      if (
        existing.status !== "draft" &&
        existing.status !== "scheduled" &&
        existing.status !== "processing"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Solo se pueden cancelar broadcasts en estado borrador, programado o procesando",
        });
      }

      const [updated] = await ctx.db
        .update(broadcasts)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(broadcasts.id, input.id),
            eq(broadcasts.creatorId, ctx.creatorId)
          )
        )
        .returning();

      return updated;
    }),

  duplicate: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.broadcasts.findFirst({
        where: and(
          eq(broadcasts.id, input.id),
          eq(broadcasts.creatorId, ctx.creatorId)
        ),
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Broadcast no encontrado" });
      }

      await checkBroadcastLimit(ctx.db, ctx.creatorId);

      const [created] = await ctx.db
        .insert(broadcasts)
        .values({
          creatorId: ctx.creatorId,
          name: `${existing.name} (copia)`,
          content: existing.content,
          segmentId: existing.segmentId,
          platformType: existing.platformType,
          status: "draft",
        })
        .returning();

      return created;
    }),

  getRecipients: protectedProcedure
    .input(
      z.object({
        broadcastId: z.string().uuid(),
        status: z
          .enum(["pending", "sent", "failed", "manual"])
          .optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify broadcast belongs to creator
      const broadcast = await ctx.db.query.broadcasts.findFirst({
        where: and(
          eq(broadcasts.id, input.broadcastId),
          eq(broadcasts.creatorId, ctx.creatorId)
        ),
      });

      if (!broadcast) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Broadcast no encontrado" });
      }

      const conditions = [eq(broadcastRecipients.broadcastId, input.broadcastId)];

      if (input.status) {
        conditions.push(eq(broadcastRecipients.status, input.status));
      }

      const items = await ctx.db
        .select({
          id: broadcastRecipients.id,
          broadcastId: broadcastRecipients.broadcastId,
          contactId: broadcastRecipients.contactId,
          platformUserId: broadcastRecipients.platformUserId,
          resolvedContent: broadcastRecipients.resolvedContent,
          status: broadcastRecipients.status,
          sentAt: broadcastRecipients.sentAt,
          errorMessage: broadcastRecipients.errorMessage,
          createdAt: broadcastRecipients.createdAt,
          contact: {
            id: contacts.id,
            username: contacts.username,
            displayName: contacts.displayName,
            platformType: contacts.platformType,
          },
        })
        .from(broadcastRecipients)
        .leftJoin(contacts, eq(broadcastRecipients.contactId, contacts.id))
        .where(and(...conditions))
        .orderBy(desc(broadcastRecipients.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [totalResult] = await ctx.db
        .select({ total: count() })
        .from(broadcastRecipients)
        .where(and(...conditions));

      return {
        items,
        total: totalResult?.total ?? 0,
      };
    }),
});
