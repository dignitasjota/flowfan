import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  conversations,
  messages,
  platforms,
  contacts,
  notes,
  aiUsageLog,
  aiConfigs,
} from "@/server/db/schema";
import { generateSuggestion } from "@/server/services/ai";

export const aiRouter = createTRPCRouter({
  suggest: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        fanMessage: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get AI config for this creator
      const aiConfig = await ctx.db.query.aiConfigs.findFirst({
        where: eq(aiConfigs.creatorId, ctx.creatorId),
      });

      if (!aiConfig) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No has configurado tu proveedor de IA. Ve a Configuración > Modelo IA para configurarlo.",
        });
      }

      // Get conversation with contact
      const conversation = await ctx.db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, input.conversationId),
          eq(conversations.creatorId, ctx.creatorId)
        ),
        with: {
          contact: { with: { profile: true } },
          messages: { orderBy: (m, { asc }) => [asc(m.createdAt)] },
        },
      });

      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      // Get platform personality
      const platform = await ctx.db.query.platforms.findFirst({
        where: and(
          eq(platforms.creatorId, ctx.creatorId),
          eq(platforms.platformType, conversation.platformType)
        ),
      });

      // Get contact notes
      const contactNotes = await ctx.db.query.notes.findMany({
        where: and(
          eq(notes.creatorId, ctx.creatorId),
          eq(notes.contactId, conversation.contactId)
        ),
      });

      // Save the fan message first
      await ctx.db.insert(messages).values({
        conversationId: input.conversationId,
        role: "fan",
        content: input.fanMessage,
      });

      // Update timestamps
      await ctx.db
        .update(conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversations.id, input.conversationId));

      await ctx.db
        .update(contacts)
        .set({ lastInteractionAt: new Date() })
        .where(eq(contacts.id, conversation.contactId));

      // Generate AI suggestion using creator's configured provider
      const result = await generateSuggestion(
        {
          provider: aiConfig.provider,
          model: aiConfig.model,
          apiKey: aiConfig.apiKey,
        },
        {
          platformType: conversation.platformType,
          personality:
            (platform?.personalityConfig as Record<string, unknown>) ?? {},
          contactProfile: conversation.contact.profile,
          conversationHistory: conversation.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          contactNotes: contactNotes.map((n) => n.content),
          fanMessage: input.fanMessage,
        }
      );

      // Log AI usage
      await ctx.db.insert(aiUsageLog).values({
        creatorId: ctx.creatorId,
        requestType: "suggestion",
        tokensUsed: result.tokensUsed,
        modelUsed: `${result.provider}/${result.model}`,
      });

      return {
        suggestions: result.suggestions,
        tokensUsed: result.tokensUsed,
      };
    }),

  regenerate: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const aiConfig = await ctx.db.query.aiConfigs.findFirst({
        where: eq(aiConfigs.creatorId, ctx.creatorId),
      });

      if (!aiConfig) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No has configurado tu proveedor de IA.",
        });
      }

      const conversation = await ctx.db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, input.conversationId),
          eq(conversations.creatorId, ctx.creatorId)
        ),
        with: {
          contact: { with: { profile: true } },
          messages: { orderBy: (m, { asc }) => [asc(m.createdAt)] },
        },
      });

      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      // Find the last fan message to regenerate from
      const lastFanMessage = [...conversation.messages]
        .reverse()
        .find((m) => m.role === "fan");

      if (!lastFanMessage) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No hay mensaje del fan para regenerar.",
        });
      }

      const platform = await ctx.db.query.platforms.findFirst({
        where: and(
          eq(platforms.creatorId, ctx.creatorId),
          eq(platforms.platformType, conversation.platformType)
        ),
      });

      const contactNotes = await ctx.db.query.notes.findMany({
        where: and(
          eq(notes.creatorId, ctx.creatorId),
          eq(notes.contactId, conversation.contactId)
        ),
      });

      // Get messages up to (not including) the last fan message for history
      const lastFanIndex = conversation.messages.findLastIndex(
        (m) => m.role === "fan"
      );
      const historyMessages = conversation.messages.slice(0, lastFanIndex);

      const result = await generateSuggestion(
        {
          provider: aiConfig.provider,
          model: aiConfig.model,
          apiKey: aiConfig.apiKey,
        },
        {
          platformType: conversation.platformType,
          personality:
            (platform?.personalityConfig as Record<string, unknown>) ?? {},
          contactProfile: conversation.contact.profile,
          conversationHistory: historyMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          contactNotes: contactNotes.map((n) => n.content),
          fanMessage: lastFanMessage.content,
        }
      );

      await ctx.db.insert(aiUsageLog).values({
        creatorId: ctx.creatorId,
        requestType: "suggestion",
        tokensUsed: result.tokensUsed,
        modelUsed: `${result.provider}/${result.model}`,
      });

      return {
        suggestions: result.suggestions,
        tokensUsed: result.tokensUsed,
      };
    }),
});
