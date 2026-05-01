import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { randomBytes } from "crypto";
import { createTRPCRouter, ownerProcedure } from "../trpc";
import { webhookConfigs, webhookDeliveryLogs } from "@/server/db/schema";
import { checkWebhookAccess } from "@/server/services/usage-limits";
import { dispatchWebhookEvent } from "@/server/services/webhook-dispatcher";
import { encrypt } from "@/lib/crypto";

const WEBHOOK_EVENTS = [
  "contact.created",
  "contact.updated",
  "message.received",
  "funnel_stage.changed",
  "transaction.created",
] as const;

export const webhooksOutgoingRouter = createTRPCRouter({
  list: ownerProcedure.query(async ({ ctx }) => {
    await checkWebhookAccess(ctx.db, ctx.creatorId);
    return ctx.db.query.webhookConfigs.findMany({
      where: eq(webhookConfigs.creatorId, ctx.creatorId),
      orderBy: (w, { desc }) => [desc(w.createdAt)],
    });
  }),

  create: ownerProcedure
    .input(z.object({
      url: z.string().url(),
      events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
      description: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await checkWebhookAccess(ctx.db, ctx.creatorId);

      const secret = randomBytes(32).toString("hex");
      const encryptedSecret = encrypt(secret);

      const [created] = await ctx.db
        .insert(webhookConfigs)
        .values({
          creatorId: ctx.creatorId,
          url: input.url,
          events: input.events,
          secret: encryptedSecret,
          description: input.description ?? null,
        })
        .returning();

      return { ...created, secret }; // Show secret only on creation
    }),

  update: ownerProcedure
    .input(z.object({
      id: z.string().uuid(),
      url: z.string().url().optional(),
      events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
      isActive: z.boolean().optional(),
      description: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      await ctx.db
        .update(webhookConfigs)
        .set({ ...updates, updatedAt: new Date() })
        .where(
          and(
            eq(webhookConfigs.id, id),
            eq(webhookConfigs.creatorId, ctx.creatorId)
          )
        );
      return { success: true };
    }),

  delete: ownerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(webhookConfigs)
        .where(
          and(
            eq(webhookConfigs.id, input.id),
            eq(webhookConfigs.creatorId, ctx.creatorId)
          )
        );
      return { success: true };
    }),

  getDeliveryLogs: ownerProcedure
    .input(z.object({
      webhookConfigId: z.string().uuid(),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      // Verify ownership
      const config = await ctx.db.query.webhookConfigs.findFirst({
        where: and(
          eq(webhookConfigs.id, input.webhookConfigId),
          eq(webhookConfigs.creatorId, ctx.creatorId)
        ),
      });
      if (!config) return [];

      return ctx.db
        .select()
        .from(webhookDeliveryLogs)
        .where(eq(webhookDeliveryLogs.webhookConfigId, input.webhookConfigId))
        .orderBy(desc(webhookDeliveryLogs.createdAt))
        .limit(input.limit);
    }),

  testWebhook: ownerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await checkWebhookAccess(ctx.db, ctx.creatorId);

      const config = await ctx.db.query.webhookConfigs.findFirst({
        where: and(
          eq(webhookConfigs.id, input.id),
          eq(webhookConfigs.creatorId, ctx.creatorId)
        ),
      });

      if (!config) return { success: false, error: "Webhook not found" };

      await dispatchWebhookEvent(ctx.db, ctx.creatorId, "contact.updated", {
        test: true,
        message: "This is a test webhook from FanFlow",
        timestamp: new Date().toISOString(),
      });

      return { success: true };
    }),
});
