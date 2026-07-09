import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { pushSubscriptions } from "@/server/db/schema";
import { getVapidPublicKey, isPushConfigured } from "@/server/services/push-notifications";

export const pushRouter = createTRPCRouter({
  /** Clave pública VAPID + si el push está habilitado en el servidor. */
  getConfig: protectedProcedure.query(async ({ ctx }) => {
    const endpointsCount = await ctx.db.query.pushSubscriptions.findMany({
      where: eq(pushSubscriptions.userId, ctx.actingUserId),
      columns: { id: true },
    });
    return {
      enabled: isPushConfigured(),
      publicKey: getVapidPublicKey(),
      subscribedDevices: endpointsCount.length,
    };
  }),

  /** Registra (o refresca) una suscripción push del navegador actual. */
  subscribe: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url(),
        p256dh: z.string().min(1),
        auth: z.string().min(1),
        userAgent: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(pushSubscriptions)
        .values({
          creatorId: ctx.creatorId,
          userId: ctx.actingUserId,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent: input.userAgent ?? null,
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            creatorId: ctx.creatorId,
            userId: ctx.actingUserId,
            p256dh: input.p256dh,
            auth: input.auth,
          },
        });
      return { success: true };
    }),

  /** Elimina una suscripción por endpoint (al desactivar en este navegador). */
  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.endpoint, input.endpoint),
            eq(pushSubscriptions.userId, ctx.actingUserId)
          )
        );
      return { success: true };
    }),
});
