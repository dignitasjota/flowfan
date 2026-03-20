import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure, ownerProcedure } from "../trpc";
import { aiConfigs, aiModelAssignments } from "@/server/db/schema";
import { PROVIDER_MODELS } from "@/server/services/ai";
import { checkFeatureAccess } from "@/server/services/usage-limits";
import { encrypt, decrypt } from "@/lib/crypto";

export const aiConfigRouter = createTRPCRouter({
  get: protectedProcedure.query(async ({ ctx }) => {
    const config = await ctx.db.query.aiConfigs.findFirst({
      where: eq(aiConfigs.creatorId, ctx.creatorId),
    });

    if (!config) return null;

    // Decrypt then mask API key for frontend display
    const decryptedKey = decrypt(config.apiKey);
    return {
      ...config,
      apiKey: maskApiKey(decryptedKey),
    };
  }),

  upsert: ownerProcedure
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

      // If apiKey is masked (hasn't changed), keep the existing encrypted value
      // Otherwise, encrypt the new key before storing
      const apiKeyToStore =
        input.apiKey.includes("••••") && existing
          ? existing.apiKey
          : encrypt(input.apiKey);

      if (existing) {
        const [updated] = await ctx.db
          .update(aiConfigs)
          .set({
            provider: input.provider,
            model: input.model,
            apiKey: apiKeyToStore,
            updatedAt: new Date(),
          })
          .where(eq(aiConfigs.id, existing.id))
          .returning();
        return { ...updated!, apiKey: maskApiKey(decrypt(updated!.apiKey)) };
      }

      const [created] = await ctx.db
        .insert(aiConfigs)
        .values({
          creatorId: ctx.creatorId,
          provider: input.provider,
          model: input.model,
          apiKey: apiKeyToStore,
        })
        .returning();
      return { ...created!, apiKey: maskApiKey(decrypt(created!.apiKey)) };
    }),

  getModels: protectedProcedure.query(() => {
    return PROVIDER_MODELS;
  }),

  testConnection: ownerProcedure
    .input(
      z.object({
        provider: z.enum(["anthropic", "openai", "google", "minimax", "kimi"]),
        model: z.string().min(1),
        apiKey: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // If apiKey is masked, get the real one from DB and decrypt
      let apiKey = input.apiKey;
      if (apiKey.includes("••••")) {
        const existing = await ctx.db.query.aiConfigs.findFirst({
          where: eq(aiConfigs.creatorId, ctx.creatorId),
        });
        if (!existing) throw new Error("No hay API key guardada");
        apiKey = decrypt(existing.apiKey);
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

  // --- Multi-model assignments ---

  getAssignments: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.aiModelAssignments.findMany({
      where: eq(aiModelAssignments.creatorId, ctx.creatorId),
    });
  }),

  upsertAssignment: ownerProcedure
    .input(
      z.object({
        taskType: z.enum(["suggestion", "analysis", "summary", "report", "price_advice"]),
        provider: z.enum(["anthropic", "openai", "google", "minimax", "kimi"]),
        model: z.string().min(1),
        apiKey: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkFeatureAccess(ctx.db, ctx.creatorId, "multiModel");

      const existing = await ctx.db.query.aiModelAssignments.findFirst({
        where: and(
          eq(aiModelAssignments.creatorId, ctx.creatorId),
          eq(aiModelAssignments.taskType, input.taskType)
        ),
      });

      // Resolve API key: use provided (encrypted), keep existing, or null (will fallback to default)
      let apiKey: string | null = input.apiKey ?? null;
      if (apiKey && apiKey.includes("••••") && existing) {
        apiKey = existing.apiKey;
      } else if (apiKey && !apiKey.includes("••••")) {
        apiKey = encrypt(apiKey);
      }

      if (existing) {
        const [updated] = await ctx.db
          .update(aiModelAssignments)
          .set({
            provider: input.provider,
            model: input.model,
            apiKey,
            updatedAt: new Date(),
          })
          .where(eq(aiModelAssignments.id, existing.id))
          .returning();
        return updated;
      }

      const [created] = await ctx.db
        .insert(aiModelAssignments)
        .values({
          creatorId: ctx.creatorId,
          taskType: input.taskType,
          provider: input.provider,
          model: input.model,
          apiKey,
        })
        .returning();
      return created;
    }),

  deleteAssignment: ownerProcedure
    .input(z.object({
      taskType: z.enum(["suggestion", "analysis", "summary", "report", "price_advice"]),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(aiModelAssignments)
        .where(
          and(
            eq(aiModelAssignments.creatorId, ctx.creatorId),
            eq(aiModelAssignments.taskType, input.taskType)
          )
        );
      return { success: true };
    }),
});

function maskApiKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 4) + "••••••••" + key.slice(-4);
}
