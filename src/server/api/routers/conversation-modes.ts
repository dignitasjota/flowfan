import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { conversationModes } from "@/server/db/schema";
import { DEFAULT_CONVERSATION_MODES } from "@/server/services/conversation-mode-resolver";
import type { ConversationModeType } from "@/server/services/conversation-mode-resolver";

const activationCriteriaSchema = z.object({
  minEngagement: z.number().optional(),
  maxEngagement: z.number().optional(),
  minPaymentProbability: z.number().optional(),
  maxPaymentProbability: z.number().optional(),
  funnelStages: z.array(z.string()).optional(),
  minTotalSpent: z.number().optional(),
  minMessageCount: z.number().optional(),
  minDaysSinceLastInteraction: z.number().optional(),
  minSentimentTrend: z.number().optional(),
});

export const conversationModesRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const modes = await ctx.db.query.conversationModes.findMany({
      where: eq(conversationModes.creatorId, ctx.creatorId),
      orderBy: (m, { asc }) => [asc(m.priority)],
    });

    // If no custom modes, return defaults
    if (modes.length === 0) {
      return Object.values(DEFAULT_CONVERSATION_MODES).map((m) => ({
        id: null,
        creatorId: ctx.creatorId,
        ...m,
        isActive: true,
        isDefault: true,
      }));
    }

    return modes.map((m) => ({
      ...m,
      objectives: (m.objectives as string[]) ?? [],
      restrictions: (m.restrictions as string[]) ?? [],
      activationCriteria: (m.activationCriteria as Record<string, unknown>) ?? {},
      isDefault: false,
    }));
  }),

  upsert: protectedProcedure
    .input(
      z.object({
        modeType: z.enum(["BASE", "POTENCIAL_PREMIUM", "CONVERSION", "VIP", "LOW_VALUE"]),
        name: z.string().min(1).max(100),
        description: z.string().nullable(),
        tone: z.string().max(255).nullable(),
        style: z.string().max(255).nullable(),
        messageLength: z.enum(["short", "medium", "long"]).nullable(),
        objectives: z.array(z.string()),
        restrictions: z.array(z.string()),
        additionalInstructions: z.string().nullable(),
        activationCriteria: activationCriteriaSchema,
        priority: z.number().int(),
        isActive: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.conversationModes.findFirst({
        where: and(
          eq(conversationModes.creatorId, ctx.creatorId),
          eq(conversationModes.modeType, input.modeType)
        ),
      });

      if (existing) {
        const [updated] = await ctx.db
          .update(conversationModes)
          .set({
            name: input.name,
            description: input.description,
            tone: input.tone,
            style: input.style,
            messageLength: input.messageLength,
            objectives: input.objectives,
            restrictions: input.restrictions,
            additionalInstructions: input.additionalInstructions,
            activationCriteria: input.activationCriteria,
            priority: input.priority,
            isActive: input.isActive,
            updatedAt: new Date(),
          })
          .where(eq(conversationModes.id, existing.id))
          .returning();
        return updated;
      }

      const [created] = await ctx.db
        .insert(conversationModes)
        .values({
          creatorId: ctx.creatorId,
          modeType: input.modeType,
          name: input.name,
          description: input.description,
          tone: input.tone,
          style: input.style,
          messageLength: input.messageLength,
          objectives: input.objectives,
          restrictions: input.restrictions,
          additionalInstructions: input.additionalInstructions,
          activationCriteria: input.activationCriteria,
          priority: input.priority,
          isActive: input.isActive,
        })
        .returning();
      return created;
    }),

  initDefaults: protectedProcedure.mutation(async ({ ctx }) => {
    const existing = await ctx.db.query.conversationModes.findMany({
      where: eq(conversationModes.creatorId, ctx.creatorId),
    });

    if (existing.length > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Ya tienes modos de conversación configurados.",
      });
    }

    const defaults = Object.values(DEFAULT_CONVERSATION_MODES);
    const values = defaults.map((m) => ({
      creatorId: ctx.creatorId,
      modeType: m.modeType,
      name: m.name,
      description: m.description,
      tone: m.tone,
      style: m.style,
      messageLength: m.messageLength,
      objectives: m.objectives,
      restrictions: m.restrictions,
      additionalInstructions: m.additionalInstructions,
      activationCriteria: m.activationCriteria,
      priority: m.priority,
      isActive: true,
    }));

    await ctx.db.insert(conversationModes).values(values);
    return { success: true };
  }),

  toggleActive: protectedProcedure
    .input(
      z.object({
        modeType: z.enum(["BASE", "POTENCIAL_PREMIUM", "CONVERSION", "VIP", "LOW_VALUE"]),
        isActive: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.conversationModes.findFirst({
        where: and(
          eq(conversationModes.creatorId, ctx.creatorId),
          eq(conversationModes.modeType, input.modeType)
        ),
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Modo no encontrado." });
      }

      if (input.modeType === "BASE" && !input.isActive) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El modo BASE no se puede desactivar.",
        });
      }

      const [updated] = await ctx.db
        .update(conversationModes)
        .set({ isActive: input.isActive, updatedAt: new Date() })
        .where(eq(conversationModes.id, existing.id))
        .returning();
      return updated;
    }),
});
