import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure, ownerProcedure } from "../trpc";
import { platforms } from "@/server/db/schema";
import { checkPlatformLimit } from "@/server/services/usage-limits";
import { platformTypeSchema } from "@/lib/constants";

const personalityConfigSchema = z.object({
  role: z.string().optional(),
  tone: z.string().optional(),
  style: z.string().optional(),
  messageLength: z.enum(["short", "medium", "long"]).optional(),
  goals: z.array(z.string()).optional(),
  restrictions: z.array(z.string()).optional(),
  exampleMessages: z.array(z.string()).optional(),
  customInstructions: z.string().optional(),
});

export const platformsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.platforms.findMany({
      where: eq(platforms.creatorId, ctx.creatorId),
    });
  }),

  upsert: ownerProcedure
    .input(
      z.object({
        platformType: platformTypeSchema,
        personalityConfig: personalityConfigSchema,
        isActive: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.platforms.findFirst({
        where: and(
          eq(platforms.creatorId, ctx.creatorId),
          eq(platforms.platformType, input.platformType)
        ),
      });

      if (existing) {
        const [updated] = await ctx.db
          .update(platforms)
          .set({
            personalityConfig: input.personalityConfig,
            isActive: input.isActive,
            updatedAt: new Date(),
          })
          .where(eq(platforms.id, existing.id))
          .returning();
        return updated;
      }

      // Only check limit on insert, not update
      await checkPlatformLimit(ctx.db, ctx.creatorId);

      const [created] = await ctx.db
        .insert(platforms)
        .values({
          creatorId: ctx.creatorId,
          platformType: input.platformType,
          personalityConfig: input.personalityConfig,
          isActive: input.isActive,
        })
        .returning();
      return created;
    }),

  delete: ownerProcedure
    .input(z.object({ platformType: platformTypeSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(platforms)
        .where(
          and(
            eq(platforms.creatorId, ctx.creatorId),
            eq(platforms.platformType, input.platformType)
          )
        );
    }),
});
