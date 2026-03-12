import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { messages, conversations, contacts } from "@/server/db/schema";

export const messagesRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify conversation belongs to creator
      const conversation = await ctx.db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, input.conversationId),
          eq(conversations.creatorId, ctx.creatorId)
        ),
      });

      if (!conversation) {
        throw new Error("Conversation not found");
      }

      return ctx.db.query.messages.findMany({
        where: eq(messages.conversationId, input.conversationId),
        orderBy: (m, { asc }) => [asc(m.createdAt)],
        limit: input.limit,
        offset: input.offset,
      });
    }),

  addFanMessage: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        content: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify conversation belongs to creator
      const conversation = await ctx.db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, input.conversationId),
          eq(conversations.creatorId, ctx.creatorId)
        ),
      });

      if (!conversation) {
        throw new Error("Conversation not found");
      }

      const [message] = await ctx.db
        .insert(messages)
        .values({
          conversationId: input.conversationId,
          role: "fan",
          content: input.content,
        })
        .returning();

      // Update conversation and contact timestamps
      await ctx.db
        .update(conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversations.id, input.conversationId));

      await ctx.db
        .update(contacts)
        .set({ lastInteractionAt: new Date() })
        .where(eq(contacts.id, conversation.contactId));

      return message;
    }),

  addCreatorMessage: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        content: z.string().min(1),
        aiSuggestion: z.string().optional(),
        aiSuggestionUsed: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await ctx.db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, input.conversationId),
          eq(conversations.creatorId, ctx.creatorId)
        ),
      });

      if (!conversation) {
        throw new Error("Conversation not found");
      }

      const [message] = await ctx.db
        .insert(messages)
        .values({
          conversationId: input.conversationId,
          role: "creator",
          content: input.content,
          aiSuggestion: input.aiSuggestion,
          aiSuggestionUsed: input.aiSuggestionUsed,
        })
        .returning();

      await ctx.db
        .update(conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversations.id, input.conversationId));

      return message;
    }),
});
