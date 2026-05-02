import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, managerProcedure } from "../trpc";
import { contentGapReports, aiUsageLog, creators } from "@/server/db/schema";
import {
  aggregateConversationData,
  analyzeContentGaps,
  getTopicTrends,
} from "@/server/services/content-gap-analyzer";
import { resolveAIConfig } from "@/server/services/ai-config-resolver";
import { checkFeatureAccess } from "@/server/services/usage-limits";

export const contentGapsRouter = createTRPCRouter({
  generate: managerProcedure
    .input(
      z.object({
        periodDays: z.enum(["7", "30", "90"]).transform(Number),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkFeatureAccess(ctx.db, ctx.creatorId, "priceAdvisor"); // Pro+ feature

      const config =
        (await resolveAIConfig(ctx.db, ctx.creatorId, "content_gap")) ??
        (await resolveAIConfig(ctx.db, ctx.creatorId, "suggestion"));

      if (!config) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No has configurado tu proveedor de IA.",
        });
      }

      // Get language preference
      const creator = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, ctx.creatorId),
        columns: { settings: true },
      });
      const settings = (creator?.settings ?? {}) as Record<string, unknown>;
      const language = (settings.responseLanguage as string) || undefined;

      // Phase 1: Aggregate data
      const aggregated = await aggregateConversationData(
        ctx.db,
        ctx.creatorId,
        input.periodDays
      );

      if (aggregated.totalContacts === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No hay contactos para analizar.",
        });
      }

      // Phase 2: AI analysis
      const periodEnd = new Date();
      const periodStart = new Date();
      periodStart.setDate(periodStart.getDate() - input.periodDays);

      const result = await analyzeContentGaps(config, aggregated, language);

      // Save report
      const { tokensUsed, ...reportData } = result;
      const [saved] = await ctx.db
        .insert(contentGapReports)
        .values({
          creatorId: ctx.creatorId,
          reportData,
          periodStart,
          periodEnd,
          contactsAnalyzed: aggregated.totalContacts,
          messagesAnalyzed: aggregated.totalMessages,
          modelUsed: `${config.provider}/${config.model}`,
          tokensUsed,
        })
        .returning();

      // Log AI usage
      await ctx.db.insert(aiUsageLog).values({
        creatorId: ctx.creatorId,
        requestType: "content_gap",
        tokensUsed,
        modelUsed: `${config.provider}/${config.model}`,
      });

      return { ...result, id: saved!.id, createdAt: saved!.createdAt };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.contentGapReports.findMany({
      where: eq(contentGapReports.creatorId, ctx.creatorId),
      orderBy: [desc(contentGapReports.createdAt)],
      columns: {
        id: true,
        createdAt: true,
        periodStart: true,
        periodEnd: true,
        contactsAnalyzed: true,
        messagesAnalyzed: true,
        modelUsed: true,
      },
    });
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const report = await ctx.db.query.contentGapReports.findFirst({
        where: and(
          eq(contentGapReports.id, input.id),
          eq(contentGapReports.creatorId, ctx.creatorId)
        ),
      });

      if (!report) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Reporte no encontrado" });
      }

      return report;
    }),

  getTopicTrends: protectedProcedure.query(async ({ ctx }) => {
    return getTopicTrends(ctx.db, ctx.creatorId);
  }),
});
