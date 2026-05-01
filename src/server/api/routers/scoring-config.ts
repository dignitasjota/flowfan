import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createTRPCRouter, ownerProcedure } from "../trpc";
import { platformScoringConfigs } from "@/server/db/schema";
import {
  DEFAULT_ENGAGEMENT_WEIGHTS,
  DEFAULT_PAYMENT_WEIGHTS,
  DEFAULT_BENCHMARKS,
  DEFAULT_FUNNEL_THRESHOLDS,
  DEFAULT_CONTACT_AGE_FACTOR,
  PLATFORM_SCORING_DEFAULTS,
  mergeScoringConfig,
} from "@/server/services/scoring";

const engagementWeightsSchema = z.object({
  frequency: z.number().min(0).max(1),
  msgLength: z.number().min(0).max(1),
  sentiment: z.number().min(0).max(1),
  depth: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  convCount: z.number().min(0).max(1),
}).partial();

const paymentWeightsSchema = z.object({
  intent: z.number().min(0).max(1),
  budget: z.number().min(0).max(1),
  engagement: z.number().min(0).max(1),
  momentum: z.number().min(0).max(1),
  sentiment: z.number().min(0).max(1),
}).partial();

const benchmarksSchema = z.object({
  maxMessages: z.number().min(1),
  maxMsgLength: z.number().min(1),
  recencyHours: z.number().min(1),
  maxConversations: z.number().min(1),
  maxMsgsPerConv: z.number().min(1),
  maxBudgetMentions: z.number().min(1),
}).partial();

const funnelThresholdsSchema = z.object({
  vip: z.number().min(0).max(100),
  buyer: z.number().min(0).max(100),
  hotLead: z.number().min(0).max(100),
  interested: z.number().min(0).max(100),
  curious: z.number().min(0).max(100),
}).partial();

const contactAgeFactorSchema = z.object({
  enabled: z.boolean(),
  newContactDays: z.number().min(1),
  boostFactor: z.number().min(1).max(3),
}).partial();

const platformTypeInput = z.enum([
  "instagram", "onlyfans", "telegram", "twitter", "reddit",
]);

export const scoringConfigRouter = createTRPCRouter({
  getByPlatform: ownerProcedure
    .input(z.object({ platformType: platformTypeInput }))
    .query(async ({ ctx, input }) => {
      const config = await ctx.db.query.platformScoringConfigs.findFirst({
        where: and(
          eq(platformScoringConfigs.creatorId, ctx.creatorId),
          eq(platformScoringConfigs.platformType, input.platformType)
        ),
      });

      const merged = mergeScoringConfig(
        input.platformType,
        config ? {
          engagementWeights: config.engagementWeights as any,
          paymentWeights: config.paymentWeights as any,
          benchmarks: config.benchmarks as any,
          funnelThresholds: config.funnelThresholds as any,
          contactAgeFactor: config.contactAgeFactor as any,
        } : undefined,
      );

      return {
        hasOverride: !!config,
        ...merged,
      };
    }),

  getDefaults: ownerProcedure
    .input(z.object({ platformType: platformTypeInput }))
    .query(({ input }) => {
      const merged = mergeScoringConfig(input.platformType);
      return merged;
    }),

  upsert: ownerProcedure
    .input(z.object({
      platformType: platformTypeInput,
      engagementWeights: engagementWeightsSchema.nullable().optional(),
      paymentWeights: paymentWeightsSchema.nullable().optional(),
      benchmarks: benchmarksSchema.nullable().optional(),
      funnelThresholds: funnelThresholdsSchema.nullable().optional(),
      contactAgeFactor: contactAgeFactorSchema.nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.platformScoringConfigs.findFirst({
        where: and(
          eq(platformScoringConfigs.creatorId, ctx.creatorId),
          eq(platformScoringConfigs.platformType, input.platformType)
        ),
      });

      if (existing) {
        await ctx.db
          .update(platformScoringConfigs)
          .set({
            engagementWeights: input.engagementWeights ?? existing.engagementWeights,
            paymentWeights: input.paymentWeights ?? existing.paymentWeights,
            benchmarks: input.benchmarks ?? existing.benchmarks,
            funnelThresholds: input.funnelThresholds ?? existing.funnelThresholds,
            contactAgeFactor: input.contactAgeFactor ?? existing.contactAgeFactor,
            updatedAt: new Date(),
          })
          .where(eq(platformScoringConfigs.id, existing.id));
      } else {
        await ctx.db.insert(platformScoringConfigs).values({
          creatorId: ctx.creatorId,
          platformType: input.platformType,
          engagementWeights: input.engagementWeights,
          paymentWeights: input.paymentWeights,
          benchmarks: input.benchmarks,
          funnelThresholds: input.funnelThresholds,
          contactAgeFactor: input.contactAgeFactor,
        });
      }

      return { success: true };
    }),

  resetToDefaults: ownerProcedure
    .input(z.object({ platformType: platformTypeInput }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(platformScoringConfigs)
        .where(
          and(
            eq(platformScoringConfigs.creatorId, ctx.creatorId),
            eq(platformScoringConfigs.platformType, input.platformType)
          )
        );

      return { success: true };
    }),
});
