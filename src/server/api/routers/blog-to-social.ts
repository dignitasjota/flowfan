import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createTRPCRouter, managerProcedure } from "../trpc";
import {
  extractContent,
  generatePostsForPlatforms,
  type SocialPlatform,
} from "@/server/services/blog-to-social";
import { resolveAIConfig } from "@/server/services/ai-config-resolver";
import { aiUsageLog, creators } from "@/server/db/schema";
import { checkAIMessageLimit } from "@/server/services/usage-limits";

const PLATFORM = z.enum(["reddit", "twitter", "instagram"]);

export const blogToSocialRouter = createTRPCRouter({
  extract: managerProcedure
    .input(z.object({ url: z.string().url().max(2000) }))
    .mutation(async ({ input }) => {
      try {
        const content = await extractContent(input.url);
        if (!content.content || content.content.length < 50) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "No se pudo extraer suficiente contenido de la URL. Pega el texto manualmente.",
          });
        }
        return content;
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Error al obtener la URL: ${(err as Error).message}`,
        });
      }
    }),

  generate: managerProcedure
    .input(
      z.object({
        title: z.string().max(500).nullable().optional(),
        excerpt: z.string().max(2000).nullable().optional(),
        url: z.string().url().max(2000).nullable().optional(),
        content: z.string().min(50).max(20_000),
        platforms: z.array(PLATFORM).min(1).max(3),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkAIMessageLimit(ctx.db, ctx.creatorId);

      const config = await resolveAIConfig(ctx.db, ctx.creatorId, "suggestion");
      if (!config) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No has configurado tu proveedor de IA. Ve a Configuración > Modelo IA.",
        });
      }

      const creator = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, ctx.creatorId),
        columns: { settings: true },
      });
      const settings = (creator?.settings ?? {}) as Record<string, unknown>;
      const language = (settings.responseLanguage as string) || undefined;

      const result = await generatePostsForPlatforms(
        config,
        {
          title: input.title ?? null,
          excerpt: input.excerpt ?? null,
          content: input.content,
          url: input.url ?? null,
        },
        input.platforms as SocialPlatform[],
        { language }
      );

      if (result.drafts.length === 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "El modelo no devolvió un JSON parseable. Intenta de nuevo o cambia de proveedor.",
        });
      }

      await ctx.db.insert(aiUsageLog).values({
        creatorId: ctx.creatorId,
        requestType: "suggestion" as const,
        tokensUsed: result.tokensUsed,
        modelUsed: `${config.provider}/${config.model}`,
      });

      return {
        drafts: result.drafts,
        tokensUsed: result.tokensUsed,
      };
    }),
});
