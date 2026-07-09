import { z } from "zod";
import { randomInt } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, managerProcedure } from "../trpc";
import {
  messageExperiments,
  contacts,
} from "@/server/db/schema";
import {
  pickVariant,
  recordExperimentSend,
  calculateMessageExperimentResults,
  type MessageVariant,
} from "@/server/services/message-experiment";
import { PLATFORM_TYPES } from "@/lib/constants";
import { logTeamAction } from "@/server/services/team-audit";

const variantSchema = z.object({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
  content: z.string().min(1).max(4000),
});

/** Carga un experimento verificando ownership del tenant. */
async function loadOwnedExperiment(ctx: any, id: string) {
  const exp = await ctx.db.query.messageExperiments.findFirst({
    where: and(
      eq(messageExperiments.id, id),
      eq(messageExperiments.creatorId, ctx.creatorId)
    ),
  });
  if (!exp) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Experimento no encontrado" });
  }
  return exp;
}

export const messageExperimentsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.messageExperiments.findMany({
      where: eq(messageExperiments.creatorId, ctx.creatorId),
      orderBy: [desc(messageExperiments.createdAt)],
    });
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const exp = await loadOwnedExperiment(ctx, input.id);
      const results = await calculateMessageExperimentResults(ctx.db, exp.id);
      return { experiment: exp, results };
    }),

  /** Experimentos que están corriendo (para el selector del chat). */
  listRunning: protectedProcedure
    // platformType solo se usa para filtrar en memoria, así que aceptamos string.
    .input(z.object({ platformType: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.query.messageExperiments.findMany({
        where: and(
          eq(messageExperiments.creatorId, ctx.creatorId),
          eq(messageExperiments.status, "running")
        ),
        orderBy: [desc(messageExperiments.createdAt)],
      });
      // Filtro de plataforma en memoria: null = aplica a cualquiera.
      return rows.filter(
        (r: any) =>
          !input?.platformType ||
          !r.platformType ||
          r.platformType === input.platformType
      );
    }),

  create: managerProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        platformType: z.enum(PLATFORM_TYPES).optional(),
        variants: z.array(variantSchema).min(2).max(5),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Keys únicas
      const keys = new Set(input.variants.map((v) => v.key));
      if (keys.size !== input.variants.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Las variantes deben tener keys únicas.",
        });
      }

      const [row] = await ctx.db
        .insert(messageExperiments)
        .values({
          creatorId: ctx.creatorId,
          name: input.name,
          platformType: input.platformType ?? null,
          variants: input.variants,
          status: "draft",
        })
        .returning();

      if (ctx.teamRole) {
        await logTeamAction(ctx.db, {
          creatorId: ctx.creatorId,
          userId: ctx.actingUserId,
          userName: ctx.session?.user?.name ?? "",
          action: "message_experiment.created",
          entityType: "message_experiment",
          entityId: row.id,
          details: { name: input.name, variants: input.variants.length },
        });
      }
      return row;
    }),

  update: managerProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        variants: z.array(variantSchema).min(2).max(5).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const exp = await loadOwnedExperiment(ctx, input.id);
      if (exp.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Solo se pueden editar experimentos en borrador.",
        });
      }
      if (input.variants) {
        const keys = new Set(input.variants.map((v) => v.key));
        if (keys.size !== input.variants.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Las variantes deben tener keys únicas.",
          });
        }
      }
      await ctx.db
        .update(messageExperiments)
        .set({
          ...(input.name ? { name: input.name } : {}),
          ...(input.variants ? { variants: input.variants } : {}),
          updatedAt: new Date(),
        })
        .where(eq(messageExperiments.id, input.id));
      return { success: true };
    }),

  start: managerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const exp = await loadOwnedExperiment(ctx, input.id);
      if (exp.status === "running") return { success: true };
      if (exp.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Solo se pueden iniciar experimentos en borrador.",
        });
      }
      await ctx.db
        .update(messageExperiments)
        .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
        .where(eq(messageExperiments.id, input.id));
      return { success: true };
    }),

  stop: managerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadOwnedExperiment(ctx, input.id);
      await ctx.db
        .update(messageExperiments)
        .set({ status: "completed", endedAt: new Date(), updatedAt: new Date() })
        .where(eq(messageExperiments.id, input.id));
      return { success: true };
    }),

  applyWinner: managerProcedure
    .input(z.object({ id: z.string().uuid(), variantKey: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const exp = await loadOwnedExperiment(ctx, input.id);
      const variants = (exp.variants ?? []) as MessageVariant[];
      if (!variants.some((v) => v.key === input.variantKey)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Variante inválida" });
      }
      await ctx.db
        .update(messageExperiments)
        .set({
          winnerVariantKey: input.variantKey,
          status: "completed",
          endedAt: exp.endedAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(messageExperiments.id, input.id));
      const winner = variants.find((v) => v.key === input.variantKey)!;
      return { success: true, content: winner.content };
    }),

  delete: managerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadOwnedExperiment(ctx, input.id);
      await ctx.db
        .delete(messageExperiments)
        .where(eq(messageExperiments.id, input.id));
      return { success: true };
    }),

  /**
   * Elige una variante para enviar a un contacto y registra el send.
   * Devuelve el contenido para que el cliente rellene el textarea.
   */
  pickForSend: protectedProcedure
    .input(
      z.object({
        experimentId: z.string().uuid(),
        contactId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const exp = await loadOwnedExperiment(ctx, input.experimentId);
      if (exp.status !== "running") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El experimento no está activo.",
        });
      }
      // Verificar que el contacto pertenece al tenant (evita IDOR).
      const contact = await ctx.db.query.contacts.findFirst({
        where: and(
          eq(contacts.id, input.contactId),
          eq(contacts.creatorId, ctx.creatorId)
        ),
        columns: { id: true },
      });
      if (!contact) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contacto no encontrado" });
      }

      const variants = (exp.variants ?? []) as MessageVariant[];
      const variant = pickVariant(variants, () => randomInt(0, 1_000_000) / 1_000_000);
      if (!variant) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Sin variantes" });
      }

      const sendId = await recordExperimentSend(ctx.db, {
        experimentId: exp.id,
        creatorId: ctx.creatorId,
        contactId: input.contactId,
        variantKey: variant.key,
      });

      return {
        sendId,
        variantKey: variant.key,
        label: variant.label,
        content: variant.content,
      };
    }),
});
