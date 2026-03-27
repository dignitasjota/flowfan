import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { conversationModes, contacts, contactProfiles } from "@/server/db/schema";
import {
  DEFAULT_CONVERSATION_MODES,
  resolveConversationMode,
} from "@/server/services/conversation-mode-resolver";
import type {
  ConversationModeType,
  ConversationMode,
} from "@/server/services/conversation-mode-resolver";
import type { BehavioralSignals } from "@/server/services/scoring";

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
        id: null as string | null,
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
        activationCriteria: m.activationCriteria as Record<string, unknown>,
        priority: m.priority,
        isActive: true,
        isDefault: true,
      }));
    }

    return modes.map((m) => ({
      id: m.id as string | null,
      creatorId: m.creatorId,
      modeType: m.modeType,
      name: m.name,
      description: m.description,
      tone: m.tone,
      style: m.style,
      messageLength: m.messageLength,
      objectives: (m.objectives as string[]) ?? [],
      restrictions: (m.restrictions as string[]) ?? [],
      additionalInstructions: m.additionalInstructions,
      activationCriteria: (m.activationCriteria as Record<string, unknown>) ?? {},
      priority: m.priority,
      isActive: m.isActive,
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

  resolveForContact: protectedProcedure
    .input(z.object({ contactId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const contact = await ctx.db.query.contacts.findFirst({
        where: and(
          eq(contacts.id, input.contactId),
          eq(contacts.creatorId, ctx.creatorId)
        ),
        with: { profile: true },
      });

      if (!contact) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contacto no encontrado." });
      }

      if (contact.platformType !== "onlyfans") {
        return null;
      }

      if (!contact.profile) {
        return null;
      }

      const dbModes = await ctx.db.query.conversationModes.findMany({
        where: eq(conversationModes.creatorId, ctx.creatorId),
      });

      const modes: ConversationMode[] = dbModes.length > 0
        ? dbModes.map((m) => ({
            modeType: m.modeType as ConversationMode["modeType"],
            name: m.name,
            description: m.description,
            tone: m.tone,
            style: m.style,
            messageLength: m.messageLength,
            objectives: (m.objectives as string[]) ?? [],
            restrictions: (m.restrictions as string[]) ?? [],
            additionalInstructions: m.additionalInstructions,
            activationCriteria: (m.activationCriteria as ConversationMode["activationCriteria"]) ?? {},
            priority: m.priority,
            isActive: m.isActive,
          }))
        : Object.values(DEFAULT_CONVERSATION_MODES).map((m) => ({ ...m, isActive: true }));

      const signals = (contact.profile.behavioralSignals ?? {}) as BehavioralSignals;

      const contactData = {
        engagementLevel: contact.profile.engagementLevel ?? 0,
        paymentProbability: contact.profile.paymentProbability ?? 0,
        funnelStage: contact.profile.funnelStage ?? "cold",
        behavioralSignals: {
          messageCount: signals?.messageCount,
          sentimentTrend: signals?.sentimentTrend,
          lastMessageAt: signals?.lastMessageAt as string | undefined,
        },
        totalSpentCents: (contact.profile as unknown as { totalSpentCents?: number }).totalSpentCents ?? 0,
      };

      const resolved = resolveConversationMode(modes, contactData);
      if (!resolved) return null;

      return {
        modeType: resolved.modeType,
        name: resolved.name,
        description: resolved.description,
      };
    }),
});
