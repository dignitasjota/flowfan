import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { platforms } from "@/server/db/schema";

const personalityConfigSchema = z.object({
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

  upsert: protectedProcedure
    .input(
      z.object({
        platformType: z.enum([
          "instagram",
          "tinder",
          "reddit",
          "onlyfans",
          "twitter",
          "telegram",
          "snapchat",
          "other",
        ]),
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

  delete: protectedProcedure
    .input(z.object({ platformType: z.enum([
      "instagram", "tinder", "reddit", "onlyfans",
      "twitter", "telegram", "snapchat", "other",
    ]) }))
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
