import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { createChildLogger } from "@/lib/logger";
import { publishEvent } from "@/lib/redis-pubsub";

const log = createChildLogger("messages-router");
import { messages, conversations, contacts } from "@/server/db/schema";
import { analysisQueue, telegramOutgoingQueue } from "@/server/queues";
import { logTeamAction } from "@/server/services/team-audit";
import { markExperimentReplyForContact } from "@/server/services/message-experiment";
import { sendPushToCreator } from "@/server/services/push-notifications";
import { canAccessConversation } from "../access";

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

      // TEN-6: los chatters solo pueden leer/escribir en conversaciones asignadas.
      if (!(await canAccessConversation(ctx, input.conversationId))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tienes acceso a esta conversación",
        });
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

      // TEN-6: los chatters solo pueden leer/escribir en conversaciones asignadas.
      if (!(await canAccessConversation(ctx, input.conversationId))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tienes acceso a esta conversación",
        });
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

      // A/B de mensajes: el fan respondió → marca el send abierto como replied.
      markExperimentReplyForContact(ctx.db, ctx.creatorId, conversation.contactId).catch(
        () => {}
      );

      // Publish real-time event
      if (message) {
        // Get contact name for notification
        const contact = await ctx.db.query.contacts.findFirst({
          where: eq(contacts.id, conversation.contactId),
          columns: { username: true, displayName: true },
        });

        const contactName = contact?.displayName ?? contact?.username ?? "Fan";
        publishEvent(ctx.creatorId, {
          type: "new_message",
          data: {
            conversationId: input.conversationId,
            messageId: message.id,
            role: "fan",
            contactName,
          },
        }).catch(() => {});

        // Push notification (no-op si el creator no tiene suscripciones o VAPID).
        sendPushToCreator(ctx.db, ctx.creatorId, {
          title: `Nuevo mensaje de ${contactName}`,
          body: input.content.slice(0, 120),
          url: `/conversations?c=${input.conversationId}`,
          tag: `conv-${input.conversationId}`,
        }).catch(() => {});
      }

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

      // TEN-6: los chatters solo pueden leer/escribir en conversaciones asignadas.
      if (!(await canAccessConversation(ctx, input.conversationId))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tienes acceso a esta conversación",
        });
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

      // Publish real-time event
      if (message) {
        publishEvent(ctx.creatorId, {
          type: "new_message",
          data: {
            conversationId: input.conversationId,
            messageId: message.id,
            role: "creator",
          },
        }).catch(() => {});
      }

      // Audit log for team members
      if (ctx.teamRole) {
        logTeamAction(ctx.db, {
          creatorId: ctx.creatorId,
          userId: ctx.actingUserId,
          userName: ctx.session!.user.name ?? "Unknown",
          action: "message.sent",
          entityType: "message",
          entityId: message?.id,
          details: { conversationId: input.conversationId },
        });
      }

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
