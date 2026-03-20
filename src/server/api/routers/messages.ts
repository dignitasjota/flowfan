import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("messages-router");
import { messages, conversations, contacts } from "@/server/db/schema";
import { analysisQueue, telegramOutgoingQueue } from "@/server/queues";

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
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
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
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
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

      // Enqueue analysis job (processed by worker)
      if (message) {
        const recentMessages = await ctx.db.query.messages.findMany({
          where: eq(messages.conversationId, input.conversationId),
          orderBy: (m, { desc }) => [desc(m.createdAt)],
          limit: 5,
        });

        analysisQueue
          .add("analyze", {
            creatorId: ctx.creatorId,
            contactId: conversation.contactId,
            messageId: message.id,
            conversationId: input.conversationId,
            messageContent: input.content,
            platformType: conversation.platformType,
            conversationHistory: recentMessages.reverse().map((m) => ({
              role: m.role,
              content: m.content,
            })),
          })
          .catch((err) => {
            log.error({ err }, "Failed to enqueue analysis job");
          });
      }

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
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      const [message] = await ctx.db
        .insert(messages)
        .values({
          conversationId: input.conversationId,
          role: "creator",
          content: input.content,
          aiSuggestion: input.aiSuggestion,
          aiSuggestionUsed: input.aiSuggestionUsed,
          sentById: ctx.actingUserId,
        })
        .returning();

      await ctx.db
        .update(conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversations.id, input.conversationId));

      // If conversation is on Telegram, enqueue outgoing message
      if (conversation.platformType === "telegram" && message) {
        const contact = await ctx.db.query.contacts.findFirst({
          where: eq(contacts.id, conversation.contactId),
          columns: { platformUserId: true },
        });

        if (contact?.platformUserId) {
          telegramOutgoingQueue
            .add("send", {
              creatorId: ctx.creatorId,
              chatId: contact.platformUserId,
              text: input.content,
              conversationId: input.conversationId,
              messageId: message.id,
            })
            .catch((err) => {
              log.error({ err }, "Failed to enqueue Telegram outgoing message");
            });
        }
      }

      return message;
    }),
});
