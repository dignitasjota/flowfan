import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, managerProcedure } from "../trpc";
import {
  conversationModeExperiments,
  conversationModes as conversationModesTable,
} from "@/server/db/schema";
import { calculateExperimentResults } from "@/server/services/ab-experiment";

const modeTypeSchema = z.enum([
  "BASE",
  "POTENCIAL_PREMIUM",
  "CONVERSION",
  "VIP",
  "LOW_VALUE",
]);

export const abExperimentsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.conversationModeExperiments.findMany({
      where: eq(conversationModeExperiments.creatorId, ctx.creatorId),
      orderBy: [desc(conversationModeExperiments.createdAt)],
    });
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const experiment =
        await ctx.db.query.conversationModeExperiments.findFirst({
          where: and(
            eq(conversationModeExperiments.id, input.id),
            eq(conversationModeExperiments.creatorId, ctx.creatorId)
          ),
        });

      if (!experiment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Experimento no encontrado" });
      }

      return experiment;
    }),

  create: managerProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        modeType: modeTypeSchema,
        variantAConfig: z.record(z.unknown()),
        variantBConfig: z.record(z.unknown()),
        trafficSplit: z.number().min(0).max(100).default(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check no other running experiment for same mode type
      const existing =
        await ctx.db.query.conversationModeExperiments.findFirst({
          where: and(
            eq(conversationModeExperiments.creatorId, ctx.creatorId),
            eq(conversationModeExperiments.modeType, input.modeType),
            eq(conversationModeExperiments.status, "running")
          ),
        });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Ya existe un experimento en ejecucion para este tipo de modo.",
        });
      }

      const [experiment] = await ctx.db
        .insert(conversationModeExperiments)
        .values({
          creatorId: ctx.creatorId,
          name: input.name,
          modeType: input.modeType,
          variantAConfig: input.variantAConfig,
          variantBConfig: input.variantBConfig,
          trafficSplit: input.trafficSplit,
        })
        .returning();

      return experiment;
    }),

  start: managerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const experiment =
        await ctx.db.query.conversationModeExperiments.findFirst({
          where: and(
            eq(conversationModeExperiments.id, input.id),
            eq(conversationModeExperiments.creatorId, ctx.creatorId)
          ),
        });

      if (!experiment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Experimento no encontrado" });
      }

      if (experiment.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Solo se pueden iniciar experimentos en estado borrador.",
        });
      }

      // Check no other running experiment for same mode type
      const running =
        await ctx.db.query.conversationModeExperiments.findFirst({
          where: and(
            eq(conversationModeExperiments.creatorId, ctx.creatorId),
            eq(conversationModeExperiments.modeType, experiment.modeType),
            eq(conversationModeExperiments.status, "running")
          ),
        });

      if (running) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Ya existe un experimento en ejecucion para este tipo de modo.",
        });
      }

      const [updated] = await ctx.db
        .update(conversationModeExperiments)
        .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
        .where(eq(conversationModeExperiments.id, input.id))
        .returning();

      return updated;
    }),

  stop: managerProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        winner: z.enum(["A", "B"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const experiment =
        await ctx.db.query.conversationModeExperiments.findFirst({
          where: and(
            eq(conversationModeExperiments.id, input.id),
            eq(conversationModeExperiments.creatorId, ctx.creatorId)
          ),
        });

      if (!experiment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Experimento no encontrado" });
      }

      if (experiment.status !== "running") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Solo se pueden detener experimentos en ejecucion.",
        });
      }

      const [updated] = await ctx.db
        .update(conversationModeExperiments)
        .set({
          status: "completed",
          endedAt: new Date(),
          winner: input.winner ?? null,
          updatedAt: new Date(),
        })
        .where(eq(conversationModeExperiments.id, input.id))
        .returning();

      return updated;
    }),

  getResults: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const experiment =
        await ctx.db.query.conversationModeExperiments.findFirst({
          where: and(
            eq(conversationModeExperiments.id, input.id),
            eq(conversationModeExperiments.creatorId, ctx.creatorId)
          ),
        });

      if (!experiment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Experimento no encontrado" });
      }

      return calculateExperimentResults(ctx.db, experiment.id);
    }),

  applyWinner: managerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const experiment =
        await ctx.db.query.conversationModeExperiments.findFirst({
          where: and(
            eq(conversationModeExperiments.id, input.id),
            eq(conversationModeExperiments.creatorId, ctx.creatorId)
          ),
        });

      if (!experiment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Experimento no encontrado" });
      }

      if (!experiment.winner) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No se ha declarado un ganador.",
        });
      }

      const winnerConfig =
        experiment.winner === "A"
          ? (experiment.variantAConfig as Record<string, unknown>)
          : (experiment.variantBConfig as Record<string, unknown>);

      // Upsert the winning config into conversation_modes
      const existing = await ctx.db.query.conversationModes.findFirst({
        where: and(
          eq(conversationModesTable.creatorId, ctx.creatorId),
          eq(conversationModesTable.modeType, experiment.modeType)
        ),
      });

      if (existing) {
        await ctx.db
          .update(conversationModesTable)
          .set({
            tone: (winnerConfig.tone as string) ?? null,
            style: (winnerConfig.style as string) ?? null,
            messageLength: (winnerConfig.messageLength as string) ?? null,
            objectives: (winnerConfig.objectives as string[]) ?? [],
            restrictions: (winnerConfig.restrictions as string[]) ?? [],
            additionalInstructions:
              (winnerConfig.additionalInstructions as string) ?? null,
            updatedAt: new Date(),
          })
          .where(eq(conversationModesTable.id, existing.id));
      } else {
        await ctx.db.insert(conversationModesTable).values({
          creatorId: ctx.creatorId,
          modeType: experiment.modeType,
          name: (winnerConfig.name as string) ?? experiment.modeType,
          description: (winnerConfig.description as string) ?? null,
          tone: (winnerConfig.tone as string) ?? null,
          style: (winnerConfig.style as string) ?? null,
          messageLength: (winnerConfig.messageLength as string) ?? null,
          objectives: (winnerConfig.objectives as string[]) ?? [],
          restrictions: (winnerConfig.restrictions as string[]) ?? [],
          additionalInstructions:
            (winnerConfig.additionalInstructions as string) ?? null,
          priority: 0,
          isActive: true,
        });
      }

      return { success: true, appliedVariant: experiment.winner };
    }),
});
