import { z } from "zod";
import { eq, and, desc, ilike, or, sql, count } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { contacts, contactProfiles } from "@/server/db/schema";
import { checkContactLimit } from "@/server/services/usage-limits";
import { platformTypeSchema, funnelStageSchema } from "@/lib/constants";

export const contactsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        platformType: platformTypeSchema.optional(),
        search: z.string().max(100).optional(),
        funnelStage: funnelStageSchema
          .optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(contacts.creatorId, ctx.creatorId)];

      if (input?.platformType) {
        conditions.push(eq(contacts.platformType, input.platformType));
      }

      if (input?.search) {
        const searchTerm = `%${input.search}%`;
        conditions.push(
          or(
            ilike(contacts.username, searchTerm),
            ilike(contacts.displayName, searchTerm)
          )!
        );
      }

      // Get total count for pagination
      const [totalResult] = await ctx.db
        .select({ count: count() })
        .from(contacts)
        .where(and(...conditions));

      const results = await ctx.db.query.contacts.findMany({
        where: and(...conditions),
        with: { profile: true },
        orderBy: [desc(contacts.lastInteractionAt)],
        limit: input?.limit ?? 50,
        offset: input?.offset ?? 0,
      });

      // Filter by funnel stage in-memory (profile is a relation)
      const filtered = input?.funnelStage
        ? results.filter((c) => c.profile?.funnelStage === input.funnelStage)
        : results;

      return {
        items: filtered,
        total: totalResult?.count ?? 0,
        hasMore: (input?.offset ?? 0) + (input?.limit ?? 50) < (totalResult?.count ?? 0),
      };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.contacts.findFirst({
        where: and(
          eq(contacts.id, input.id),
          eq(contacts.creatorId, ctx.creatorId)
        ),
        with: {
          profile: true,
          conversations: true,
          notes: true,
        },
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        username: z.string().min(1).max(255),
        displayName: z.string().max(255).optional(),
        platformType: platformTypeSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkContactLimit(ctx.db, ctx.creatorId);

      const [contact] = await ctx.db
        .insert(contacts)
        .values({
          creatorId: ctx.creatorId,
          username: input.username,
          displayName: input.displayName,
          platformType: input.platformType,
        })
        .returning();

      // Create empty profile
      await ctx.db.insert(contactProfiles).values({
        contactId: contact!.id,
      });

      return contact;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        displayName: z.string().max(255).optional(),
        tags: z.array(z.string()).optional(),
        isArchived: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [updated] = await ctx.db
        .update(contacts)
        .set(data)
        .where(and(eq(contacts.id, id), eq(contacts.creatorId, ctx.creatorId)))
        .returning();
      return updated;
    }),
});
