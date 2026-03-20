import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  scheduledMessages,
  conversations,
  contacts,
  messages,
} from "@/server/db/schema";
import { checkScheduledMessageLimit, checkOptimalTimeSuggestion } from "@/server/services/usage-limits";

export const scheduledMessagesRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid().optional(),
        status: z.enum(["pending", "sent", "cancelled", "failed"]).optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(scheduledMessages.creatorId, ctx.creatorId)];

      if (input?.conversationId) {
        conditions.push(eq(scheduledMessages.conversationId, input.conversationId));
      }
      if (input?.status) {
        conditions.push(eq(scheduledMessages.status, input.status));
      }

      return ctx.db.query.scheduledMessages.findMany({
        where: and(...conditions),
        with: {
          conversation: {
            with: { contact: true },
          },
          contact: true,
        },
        orderBy: [desc(scheduledMessages.scheduledAt)],
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const msg = await ctx.db.query.scheduledMessages.findFirst({
        where: and(
          eq(scheduledMessages.id, input.id),
          eq(scheduledMessages.creatorId, ctx.creatorId)
        ),
        with: {
          conversation: { with: { contact: true } },
          contact: true,
        },
      });

      if (!msg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Mensaje programado no encontrado" });
      }

      return msg;
    }),

  create: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        content: z.string().min(1).max(5000),
        scheduledAt: z.string().datetime(),
        aiSuggestion: z.string().optional(),
        aiSuggestionUsed: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkScheduledMessageLimit(ctx.db, ctx.creatorId);

      const scheduledDate = new Date(input.scheduledAt);
      if (scheduledDate <= new Date()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La fecha programada debe ser en el futuro.",
        });
      }

      // Verify conversation belongs to creator
      const conversation = await ctx.db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, input.conversationId),
          eq(conversations.creatorId, ctx.creatorId)
        ),
      });

      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversación no encontrada" });
      }

      const [scheduled] = await ctx.db
        .insert(scheduledMessages)
        .values({
          creatorId: ctx.creatorId,
          conversationId: input.conversationId,
          contactId: conversation.contactId,
          content: input.content,
          scheduledAt: scheduledDate,
          aiSuggestion: input.aiSuggestion,
          aiSuggestionUsed: input.aiSuggestionUsed,
          sentById: ctx.actingUserId,
        })
        .returning();

      return scheduled;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        content: z.string().min(1).max(5000).optional(),
        scheduledAt: z.string().datetime().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.scheduledMessages.findFirst({
        where: and(
          eq(scheduledMessages.id, input.id),
          eq(scheduledMessages.creatorId, ctx.creatorId),
          eq(scheduledMessages.status, "pending")
        ),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Mensaje programado no encontrado o no se puede editar.",
        });
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.content) updates.content = input.content;
      if (input.scheduledAt) {
        const scheduledDate = new Date(input.scheduledAt);
        if (scheduledDate <= new Date()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "La fecha programada debe ser en el futuro.",
          });
        }
        updates.scheduledAt = scheduledDate;
      }

      const [updated] = await ctx.db
        .update(scheduledMessages)
        .set(updates)
        .where(eq(scheduledMessages.id, input.id))
        .returning();

      return updated;
    }),

  cancel: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(scheduledMessages)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(scheduledMessages.id, input.id),
            eq(scheduledMessages.creatorId, ctx.creatorId),
            eq(scheduledMessages.status, "pending")
          )
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Mensaje programado no encontrado o ya enviado.",
        });
      }

      return updated;
    }),

  getPendingCount: protectedProcedure.query(async ({ ctx }) => {
    const results = await ctx.db.query.scheduledMessages.findMany({
      where: and(
        eq(scheduledMessages.creatorId, ctx.creatorId),
        eq(scheduledMessages.status, "pending")
      ),
      columns: { id: true },
    });
    return results.length;
  }),

  suggestOptimalTime: protectedProcedure
    .input(z.object({ contactId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await checkOptimalTimeSuggestion(ctx.db, ctx.creatorId);

      const contactConversations = await ctx.db.query.conversations.findMany({
        where: and(
          eq(conversations.contactId, input.contactId),
          eq(conversations.creatorId, ctx.creatorId)
        ),
        columns: { id: true },
      });

      const convIds = contactConversations.map((c) => c.id);
      if (convIds.length === 0) {
        return { suggestedHour: 19, suggestedMinute: 0, confidence: "low" as const, reason: "Sin datos suficientes. Se sugiere horario nocturno por defecto." };
      }

      // Get fan messages from all conversations
      const allFanMessages = await ctx.db.query.messages.findMany({
        where: and(
          inArray(messages.conversationId, convIds),
          eq(messages.role, "fan")
        ),
        columns: { createdAt: true },
        orderBy: (m, { desc }) => [desc(m.createdAt)],
        limit: 200,
      });

      if (allFanMessages.length < 5) {
        return { suggestedHour: 19, suggestedMinute: 0, confidence: "low" as const, reason: "Pocos mensajes del fan. Se sugiere horario nocturno por defecto." };
      }

      // Analyze hour distribution of fan messages
      const hourCounts = new Array(24).fill(0) as number[];
      for (const msg of allFanMessages) {
        const hour = new Date(msg.createdAt).getHours();
        hourCounts[hour]++;
      }

      // Find the peak hour
      let peakHour = 19;
      let maxCount = 0;
      for (let h = 0; h < 24; h++) {
        if (hourCounts[h] > maxCount) {
          maxCount = hourCounts[h];
          peakHour = h;
        }
      }

      const totalMessages = allFanMessages.length;
      const peakPct = Math.round((maxCount / totalMessages) * 100);
      const confidence = peakPct > 30 ? "high" : peakPct > 15 ? "medium" : "low";

      return {
        suggestedHour: peakHour,
        suggestedMinute: 0,
        confidence: confidence as "high" | "medium" | "low",
        reason: `El fan suele escribir a las ${peakHour}:00 (${peakPct}% de mensajes). Enviar en ese horario maximiza la probabilidad de respuesta.`,
        hourDistribution: hourCounts,
      };
    }),
});
