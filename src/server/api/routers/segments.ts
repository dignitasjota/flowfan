import { z } from "zod";
import { eq, and, desc, count, sql, inArray } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { segments, segmentMembers, contacts } from "@/server/db/schema";
import { checkSegmentLimit } from "@/server/services/usage-limits";
import { evaluateSegment, type SegmentFilter } from "@/server/services/segment-evaluator";

const filterSchema = z.object({
  field: z.string(),
  operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains"]),
  value: z.unknown(),
});

const segmentTypeSchema = z.enum(["dynamic", "static", "mixed"]);

export const segmentsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.segments.findMany({
      where: eq(segments.creatorId, ctx.creatorId),
      orderBy: (s, { desc }) => [desc(s.isPredefined), desc(s.createdAt)],
    });
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const segment = await ctx.db.query.segments.findFirst({
        where: and(
          eq(segments.id, input.id),
          eq(segments.creatorId, ctx.creatorId)
        ),
      });

      if (!segment) return null;

      const [membersCount] = await ctx.db
        .select({ total: count() })
        .from(segmentMembers)
        .where(eq(segmentMembers.segmentId, input.id));

      return { ...segment, membersCount: membersCount?.total ?? 0 };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        type: segmentTypeSchema,
        filters: z.array(filterSchema).default([]),
        color: z.string().optional(),
        icon: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkSegmentLimit(ctx.db, ctx.creatorId);

      const [created] = await ctx.db
        .insert(segments)
        .values({
          creatorId: ctx.creatorId,
          name: input.name,
          description: input.description,
          type: input.type,
          filters: input.filters,
          color: input.color,
          icon: input.icon,
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
        filters: z.array(filterSchema).optional(),
        color: z.string().optional(),
        icon: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;

      // Check if predefined — only filters can be updated
      const existing = await ctx.db.query.segments.findFirst({
        where: and(
          eq(segments.id, id),
          eq(segments.creatorId, ctx.creatorId)
        ),
      });

      if (!existing) return null;

      const updates: Record<string, unknown> = { updatedAt: new Date() };

      if (existing.isPredefined) {
        // For predefined segments, only allow filter updates
        if (fields.filters !== undefined) updates.filters = fields.filters;
      } else {
        if (fields.name !== undefined) updates.name = fields.name;
        if (fields.description !== undefined) updates.description = fields.description;
        if (fields.filters !== undefined) updates.filters = fields.filters;
        if (fields.color !== undefined) updates.color = fields.color;
        if (fields.icon !== undefined) updates.icon = fields.icon;
      }

      const [updated] = await ctx.db
        .update(segments)
        .set(updates)
        .where(
          and(eq(segments.id, id), eq(segments.creatorId, ctx.creatorId))
        )
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Don't allow deleting predefined segments
      const existing = await ctx.db.query.segments.findFirst({
        where: and(
          eq(segments.id, input.id),
          eq(segments.creatorId, ctx.creatorId)
        ),
      });

      if (existing?.isPredefined) {
        throw new Error("No se pueden eliminar segmentos predefinidos");
      }

      await ctx.db
        .delete(segments)
        .where(
          and(
            eq(segments.id, input.id),
            eq(segments.creatorId, ctx.creatorId)
          )
        );

      return { success: true };
    }),

  evaluate: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const segment = await ctx.db.query.segments.findFirst({
        where: and(
          eq(segments.id, input.id),
          eq(segments.creatorId, ctx.creatorId)
        ),
      });

      if (!segment) return { contacts: [], total: 0 };

      const filters = (segment.filters ?? []) as SegmentFilter[];
      const result = await evaluateSegment(ctx.db, ctx.creatorId, {
        filters,
        segmentId: segment.id,
        segmentType: segment.type,
        limit: input.limit,
        offset: input.offset,
      });

      // Update contactCount and countUpdatedAt
      await ctx.db
        .update(segments)
        .set({
          contactCount: result.total,
          countUpdatedAt: new Date(),
        })
        .where(eq(segments.id, input.id));

      // Fetch contact details for the returned IDs
      let contactList: {
        id: string;
        username: string;
        displayName: string | null;
        platformType: string;
      }[] = [];

      if (result.contactIds.length > 0) {
        contactList = await ctx.db
          .select({
            id: contacts.id,
            username: contacts.username,
            displayName: contacts.displayName,
            platformType: contacts.platformType,
          })
          .from(contacts)
          .where(inArray(contacts.id, result.contactIds));
      }

      return { contacts: contactList, total: result.total };
    }),

  count: protectedProcedure
    .input(
      z.object({
        filters: z.array(filterSchema),
      })
    )
    .query(async ({ ctx, input }) => {
      const filters = input.filters as SegmentFilter[];
      const result = await evaluateSegment(ctx.db, ctx.creatorId, {
        filters,
        countOnly: true,
      });

      return { count: result.total };
    }),

  addMembers: protectedProcedure
    .input(
      z.object({
        segmentId: z.string().uuid(),
        contactIds: z.array(z.string().uuid()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify segment belongs to creator and is static or mixed
      const segment = await ctx.db.query.segments.findFirst({
        where: and(
          eq(segments.id, input.segmentId),
          eq(segments.creatorId, ctx.creatorId)
        ),
      });

      if (!segment || (segment.type !== "static" && segment.type !== "mixed")) {
        throw new Error("Solo se pueden agregar miembros a segmentos estáticos o mixtos");
      }

      let added = 0;
      for (const contactId of input.contactIds) {
        try {
          await ctx.db.insert(segmentMembers).values({
            segmentId: input.segmentId,
            contactId,
            membershipType: "included",
          });
          added++;
        } catch {
          // ON CONFLICT DO NOTHING — unique constraint violation
        }
      }

      return { added };
    }),

  removeMembers: protectedProcedure
    .input(
      z.object({
        segmentId: z.string().uuid(),
        contactIds: z.array(z.string().uuid()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .delete(segmentMembers)
        .where(
          and(
            eq(segmentMembers.segmentId, input.segmentId),
            inArray(segmentMembers.contactId, input.contactIds)
          )
        )
        .returning();

      return { removed: result.length };
    }),

  ensurePredefined: protectedProcedure.mutation(async ({ ctx }) => {
    const predefinedDefs = [
      {
        predefinedKey: "hot_fans",
        name: "Fans calientes",
        type: "dynamic" as const,
        icon: "\uD83D\uDD25",
        color: null,
        filters: [
          { field: "funnelStage", operator: "in", value: ["hot_lead", "buyer", "vip"] },
          { field: "paymentProbability", operator: "gte", value: 60 },
        ],
      },
      {
        predefinedKey: "inactive_30d",
        name: "Inactivos 30d",
        type: "dynamic" as const,
        icon: "\uD83D\uDE34",
        color: "#ef4444",
        filters: [
          { field: "lastInteractionAt", operator: "lt", value: "30_days_ago" },
        ],
      },
      {
        predefinedKey: "top_spenders",
        name: "Top spenders",
        type: "dynamic" as const,
        icon: "\uD83D\uDC8E",
        color: "#f59e0b",
        filters: [
          { field: "totalRevenue", operator: "gte", value: 10000 },
        ],
      },
      {
        predefinedKey: "new_7d",
        name: "Nuevos (7 d\u00edas)",
        type: "dynamic" as const,
        icon: "\u2728",
        color: "#22c55e",
        filters: [
          { field: "createdAt", operator: "gte", value: "7_days_ago" },
        ],
      },
      {
        predefinedKey: "vip_fans",
        name: "Fans VIP",
        type: "dynamic" as const,
        icon: "\uD83D\uDC51",
        color: "#8b5cf6",
        filters: [
          { field: "funnelStage", operator: "eq", value: "vip" },
        ],
      },
    ];

    let created = 0;

    for (const def of predefinedDefs) {
      const existing = await ctx.db.query.segments.findFirst({
        where: and(
          eq(segments.creatorId, ctx.creatorId),
          eq(segments.predefinedKey, def.predefinedKey)
        ),
      });

      if (!existing) {
        await ctx.db.insert(segments).values({
          creatorId: ctx.creatorId,
          name: def.name,
          type: def.type,
          icon: def.icon,
          color: def.color,
          filters: def.filters,
          isPredefined: true,
          predefinedKey: def.predefinedKey,
        });
        created++;
      }
    }

    return { created };
  }),
});
