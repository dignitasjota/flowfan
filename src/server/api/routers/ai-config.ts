import { z } from "zod";
import { eq } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { aiConfigs } from "@/server/db/schema";
import { PROVIDER_MODELS } from "@/server/services/ai";

export const aiConfigRouter = createTRPCRouter({
  get: protectedProcedure.query(async ({ ctx }) => {
    const config = await ctx.db.query.aiConfigs.findFirst({
      where: eq(aiConfigs.creatorId, ctx.creatorId),
    });

    if (!config) return null;

    // Mask API key for frontend display
    return {
      ...config,
      apiKey: maskApiKey(config.apiKey),
    };
  }),

  upsert: protectedProcedure
    .input(
      z.object({
        provider: z.enum(["anthropic", "openai", "google", "minimax", "kimi"]),
        model: z.string().min(1),
        apiKey: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.aiConfigs.findFirst({
        where: eq(aiConfigs.creatorId, ctx.creatorId),
      });

      // If apiKey is masked (hasn't changed), keep the existing one
      const apiKey =
        input.apiKey.includes("••••") && existing
          ? existing.apiKey
          : input.apiKey;

      if (existing) {
        const [updated] = await ctx.db
          .update(aiConfigs)
          .set({
            provider: input.provider,
            model: input.model,
            apiKey,
            updatedAt: new Date(),
          })
          .where(eq(aiConfigs.id, existing.id))
          .returning();
        return { ...updated!, apiKey: maskApiKey(updated!.apiKey) };
      }

      const [created] = await ctx.db
        .insert(aiConfigs)
        .values({
          creatorId: ctx.creatorId,
          provider: input.provider,
          model: input.model,
          apiKey,
        })
        .returning();
      return { ...created!, apiKey: maskApiKey(created!.apiKey) };
    }),

  getModels: protectedProcedure.query(() => {
    return PROVIDER_MODELS;
  }),

  testConnection: protectedProcedure
    .input(
      z.object({
        provider: z.enum(["anthropic", "openai", "google", "minimax", "kimi"]),
        model: z.string().min(1),
        apiKey: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // If apiKey is masked, get the real one from DB
      let apiKey = input.apiKey;
      if (apiKey.includes("••••")) {
        const existing = await ctx.db.query.aiConfigs.findFirst({
          where: eq(aiConfigs.creatorId, ctx.creatorId),
        });
        if (!existing) throw new Error("No hay API key guardada");
        apiKey = existing.apiKey;
      }

      try {
        const { generateSuggestion } = await import("@/server/services/ai");
        const result = await generateSuggestion(
          { provider: input.provider, model: input.model, apiKey },
          {
            platformType: "instagram",
            personality: { tone: "friendly" },
            contactProfile: null,
            conversationHistory: [],
            contactNotes: [],
            fanMessage: "Hola, ¿cómo estás?",
          }
        );
        return {
          success: true,
          message: `Conexión exitosa. Modelo: ${result.model}. Tokens: ${result.tokensUsed}`,
        };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : "Error desconocido",
        };
      }
    }),
});

function maskApiKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 4) + "••••••••" + key.slice(-4);
}
