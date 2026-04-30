import { z } from "zod";
import { eq, and, sql, gte, count } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { autoResponseConfigs, messages } from "@/server/db/schema";

const platformTypeSchema = z.enum([
  "instagram",
  "tinder",
  "reddit",
  "onlyfans",
  "twitter",
  "telegram",
  "snapchat",
  "other",
]);

export const autoResponseRouter = createTRPCRouter({
  getConfigs: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.autoResponseConfigs.findMany({
      where: eq(autoResponseConfigs.creatorId, ctx.creatorId),
    });
  }),

  upsertConfig: protectedProcedure
    .input(
      z.object({
        platformType: platformTypeSchema,
        isEnabled: z.boolean(),
        inactivityMinutes: z.number().min(1).max(1440).default(30),
        useAIReply: z.boolean().default(false),
        maxTokens: z.number().min(64).max(1024).default(256),
        fallbackMessage: z.string().max(1000).nullable().default(null),
        classifyMessages: z.boolean().default(true),
        preGenerateReplies: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.autoResponseConfigs.findFirst({
        where: and(
          eq(autoResponseConfigs.creatorId, ctx.creatorId),
          eq(autoResponseConfigs.platformType, input.platformType)
        ),
      });

      if (existing) {
        const [updated] = await ctx.db
          .update(autoResponseConfigs)
          .set({
            isEnabled: input.isEnabled,
            inactivityMinutes: input.inactivityMinutes,
            useAIReply: input.useAIReply,
            maxTokens: input.maxTokens,
            fallbackMessage: input.fallbackMessage,
            classifyMessages: input.classifyMessages,
            preGenerateReplies: input.preGenerateReplies,
            updatedAt: new Date(),
          })
          .where(eq(autoResponseConfigs.id, existing.id))
          .returning();
        return updated;
      }

      const [created] = await ctx.db
        .insert(autoResponseConfigs)
        .values({
          creatorId: ctx.creatorId,
          platformType: input.platformType,
          isEnabled: input.isEnabled,
          inactivityMinutes: input.inactivityMinutes,
          useAIReply: input.useAIReply,
          maxTokens: input.maxTokens,
          fallbackMessage: input.fallbackMessage,
          classifyMessages: input.classifyMessages,
          preGenerateReplies: input.preGenerateReplies,
        })
        .returning();

      return created;
    }),

  getClassificationStats: protectedProcedure.query(async ({ ctx }) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Query messages with classification in sentiment JSONB
    const stats = await ctx.db
      .select({
        category: sql<string>`(${messages.sentiment}->>'classification')::jsonb->>'category'`,
        count: count(),
      })
      .from(messages)
      .innerJoin(
        sql`conversations ON conversations.id = ${messages.conversationId}`,
        sql`conversations.creator_id = ${ctx.creatorId}`
      )
      .where(
        and(
          gte(messages.createdAt, thirtyDaysAgo),
          sql`${messages.sentiment}->>'classification' IS NOT NULL`
        )
      )
      .groupBy(sql`(${messages.sentiment}->>'classification')::jsonb->>'category'`);

    const result: Record<string, number> = {
      urgent: 0,
      price_inquiry: 0,
      spam: 0,
      general: 0,
    };

    for (const row of stats) {
      if (row.category && row.category in result) {
        result[row.category] = row.count;
      }
    }

    return result;
  }),
});
