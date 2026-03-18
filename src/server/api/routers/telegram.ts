import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { randomBytes } from "crypto";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { createChildLogger } from "@/lib/logger";
import { telegramBotConfigs } from "@/server/db/schema";
import { encrypt, decrypt } from "@/lib/crypto";
import { checkTelegramAccess } from "@/server/services/usage-limits";
import {
  validateBotToken,
  setWebhook,
  deleteWebhook,
  getWebhookInfo,
  sendMessage as tgSendMessage,
} from "@/server/services/telegram";

const log = createChildLogger("telegram-router");

function getWebhookUrl(webhookSecret: string): string {
  const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${baseUrl}/api/webhooks/telegram/${webhookSecret}`;
}

export const telegramRouter = createTRPCRouter({
  /**
   * Get current Telegram bot config and status.
   */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const config = await ctx.db.query.telegramBotConfigs.findFirst({
      where: eq(telegramBotConfigs.creatorId, ctx.creatorId),
    });

    if (!config) {
      return { connected: false as const };
    }

    return {
      connected: true as const,
      botUsername: config.botUsername,
      botId: config.botId,
      status: config.status,
      autoReplyEnabled: config.autoReplyEnabled,
      autoReplyDelaySec: config.autoReplyDelaySec,
      welcomeMessage: config.welcomeMessage,
      errorMessage: config.errorMessage,
      webhookUrl: config.webhookUrl,
      updatedAt: config.updatedAt,
    };
  }),

  /**
   * Connect a Telegram bot by providing a bot token.
   */
  connect: protectedProcedure
    .input(z.object({ botToken: z.string().min(20) }))
    .mutation(async ({ ctx, input }) => {
      await checkTelegramAccess(ctx.db, ctx.creatorId);

      // Validate the token
      const botInfo = await validateBotToken(input.botToken).catch(() => {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Token de bot inválido. Verifica que el token es correcto.",
        });
      });

      // Generate webhook secret
      const webhookSecret = randomBytes(32).toString("hex");
      const webhookUrl = getWebhookUrl(webhookSecret);

      // Set webhook on Telegram
      await setWebhook(input.botToken, webhookUrl, webhookSecret).catch((err) => {
        log.error({ err }, "Failed to set webhook");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "No se pudo configurar el webhook en Telegram.",
        });
      });

      // Encrypt token before storage
      const encryptedToken = encrypt(input.botToken);

      // Check if already exists (update) or create new
      const existing = await ctx.db.query.telegramBotConfigs.findFirst({
        where: eq(telegramBotConfigs.creatorId, ctx.creatorId),
      });

      if (existing) {
        // Delete old webhook first
        try {
          const oldToken = decrypt(existing.botToken);
          await deleteWebhook(oldToken);
        } catch {
          // Ignore — old token may be invalid
        }

        await ctx.db
          .update(telegramBotConfigs)
          .set({
            botToken: encryptedToken,
            botUsername: botInfo.username ?? null,
            botId: String(botInfo.id),
            webhookSecret,
            webhookUrl,
            status: "connected",
            updatedAt: new Date(),
          })
          .where(eq(telegramBotConfigs.id, existing.id));
      } else {
        await ctx.db.insert(telegramBotConfigs).values({
          creatorId: ctx.creatorId,
          botToken: encryptedToken,
          botUsername: botInfo.username ?? null,
          botId: String(botInfo.id),
          webhookSecret,
          webhookUrl,
          status: "connected",
        });
      }

      log.info({ creatorId: ctx.creatorId, botUsername: botInfo.username }, "Telegram bot connected");

      return {
        botUsername: botInfo.username,
        botId: String(botInfo.id),
        status: "connected" as const,
      };
    }),

  /**
   * Disconnect the Telegram bot.
   */
  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    const config = await ctx.db.query.telegramBotConfigs.findFirst({
      where: eq(telegramBotConfigs.creatorId, ctx.creatorId),
    });

    if (!config) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No hay bot de Telegram conectado." });
    }

    // Remove webhook from Telegram
    try {
      const token = decrypt(config.botToken);
      await deleteWebhook(token);
    } catch (err) {
      log.warn({ err }, "Failed to delete webhook during disconnect");
    }

    // Delete config
    await ctx.db
      .delete(telegramBotConfigs)
      .where(eq(telegramBotConfigs.id, config.id));

    log.info({ creatorId: ctx.creatorId }, "Telegram bot disconnected");

    return { success: true };
  }),

  /**
   * Update auto-reply and message settings.
   */
  updateSettings: protectedProcedure
    .input(
      z.object({
        autoReplyEnabled: z.boolean().optional(),
        autoReplyDelaySec: z.number().min(0).max(300).optional(),
        welcomeMessage: z.string().max(1000).nullable().optional(),
        errorMessage: z.string().max(500).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const config = await ctx.db.query.telegramBotConfigs.findFirst({
        where: eq(telegramBotConfigs.creatorId, ctx.creatorId),
      });

      if (!config) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No hay bot de Telegram conectado." });
      }

      await ctx.db
        .update(telegramBotConfigs)
        .set({
          ...(input.autoReplyEnabled !== undefined && { autoReplyEnabled: input.autoReplyEnabled }),
          ...(input.autoReplyDelaySec !== undefined && { autoReplyDelaySec: input.autoReplyDelaySec }),
          ...(input.welcomeMessage !== undefined && { welcomeMessage: input.welcomeMessage }),
          ...(input.errorMessage !== undefined && { errorMessage: input.errorMessage }),
          updatedAt: new Date(),
        })
        .where(eq(telegramBotConfigs.id, config.id));

      return { success: true };
    }),

  /**
   * Test connection by sending a message to the bot's own chat or checking webhook info.
   */
  testConnection: protectedProcedure.mutation(async ({ ctx }) => {
    const config = await ctx.db.query.telegramBotConfigs.findFirst({
      where: eq(telegramBotConfigs.creatorId, ctx.creatorId),
    });

    if (!config) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No hay bot de Telegram conectado." });
    }

    const token = decrypt(config.botToken);

    // Check webhook info
    const info = await getWebhookInfo(token).catch(() => {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "No se pudo verificar la conexión con Telegram.",
      });
    });

    const isHealthy = info.url === config.webhookUrl && !info.last_error_message;

    // Update status
    await ctx.db
      .update(telegramBotConfigs)
      .set({
        status: isHealthy ? "connected" : "error",
        updatedAt: new Date(),
      })
      .where(eq(telegramBotConfigs.id, config.id));

    return {
      healthy: isHealthy,
      webhookUrl: info.url,
      pendingUpdates: info.pending_update_count,
      lastError: info.last_error_message ?? null,
    };
  }),

  /**
   * Send a message to a Telegram contact (used by addCreatorMessage flow).
   */
  sendToContact: protectedProcedure
    .input(
      z.object({
        chatId: z.union([z.string(), z.number()]),
        text: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const config = await ctx.db.query.telegramBotConfigs.findFirst({
        where: eq(telegramBotConfigs.creatorId, ctx.creatorId),
      });

      if (!config) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No hay bot de Telegram conectado." });
      }

      const token = decrypt(config.botToken);
      const result = await tgSendMessage(token, input.chatId, input.text);

      return { messageId: result.message_id };
    }),
});
