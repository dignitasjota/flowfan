import { eq, sql } from "drizzle-orm";
import {
  broadcasts,
  broadcastRecipients,
  telegramBotConfigs,
} from "@/server/db/schema";
import { decrypt } from "@/lib/crypto";
import { sendMessage } from "@/server/services/telegram";
import { createChildLogger } from "@/lib/logger";

type Db = typeof import("@/server/db").db;

const log = createChildLogger("broadcast-sender");

// ---------------------------------------------------------------------------
// Send a single broadcast message
// ---------------------------------------------------------------------------

export async function sendBroadcastMessage(
  db: Db,
  recipientId: string,
): Promise<void> {
  // 1. Get recipient
  const [recipient] = await db
    .select()
    .from(broadcastRecipients)
    .where(eq(broadcastRecipients.id, recipientId))
    .limit(1);

  if (!recipient) {
    log.warn({ recipientId }, "Recipient not found");
    return;
  }

  // 2. Idempotency check
  if (recipient.status !== "pending") {
    log.info(
      { recipientId, status: recipient.status },
      "Recipient already processed, skipping",
    );
    return;
  }

  // 3. Get the broadcast to find creatorId
  const [broadcast] = await db
    .select()
    .from(broadcasts)
    .where(eq(broadcasts.id, recipient.broadcastId))
    .limit(1);

  if (!broadcast) {
    log.error({ broadcastId: recipient.broadcastId }, "Broadcast not found");
    return;
  }

  // 4. Get Telegram bot config for the creator
  const [config] = await db
    .select()
    .from(telegramBotConfigs)
    .where(eq(telegramBotConfigs.creatorId, broadcast.creatorId))
    .limit(1);

  if (!config) {
    log.error(
      { creatorId: broadcast.creatorId },
      "No Telegram bot config found",
    );
    await markFailed(
      db,
      recipientId,
      recipient.broadcastId,
      "No Telegram bot configured for this creator",
    );
    return;
  }

  // 5. Decrypt token and send
  const token = decrypt(config.botToken);
  const chatId = recipient.platformUserId;

  if (!chatId) {
    await markFailed(
      db,
      recipientId,
      recipient.broadcastId,
      "No platform user ID (chat ID) for recipient",
    );
    return;
  }

  try {
    await sendMessage(token, chatId, recipient.resolvedContent);

    // 6. Success: update recipient and increment sentCount
    await db
      .update(broadcastRecipients)
      .set({
        status: "sent",
        sentAt: new Date(),
      })
      .where(eq(broadcastRecipients.id, recipientId));

    await db
      .update(broadcasts)
      .set({
        sentCount: sql`${broadcasts.sentCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(broadcasts.id, recipient.broadcastId));

    log.info({ recipientId, chatId }, "Message sent successfully");
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown send error";

    log.error(
      { recipientId, chatId, error: errorMessage },
      "Failed to send message",
    );

    // 7. Failure: update recipient and increment failedCount
    await markFailed(db, recipientId, recipient.broadcastId, errorMessage);
  }

  // 8. Check if broadcast is complete
  await checkBroadcastCompletion(db, recipient.broadcastId);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function markFailed(
  db: Db,
  recipientId: string,
  broadcastId: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(broadcastRecipients)
    .set({
      status: "failed",
      errorMessage,
    })
    .where(eq(broadcastRecipients.id, recipientId));

  await db
    .update(broadcasts)
    .set({
      failedCount: sql`${broadcasts.failedCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(broadcasts.id, broadcastId));
}

async function checkBroadcastCompletion(
  db: Db,
  broadcastId: string,
): Promise<void> {
  const [broadcast] = await db
    .select({
      sentCount: broadcasts.sentCount,
      failedCount: broadcasts.failedCount,
      manualCount: broadcasts.manualCount,
      totalRecipients: broadcasts.totalRecipients,
      status: broadcasts.status,
    })
    .from(broadcasts)
    .where(eq(broadcasts.id, broadcastId))
    .limit(1);

  if (!broadcast || broadcast.status === "completed") return;

  const processed =
    broadcast.sentCount + broadcast.failedCount + broadcast.manualCount;

  if (processed >= broadcast.totalRecipients) {
    await db
      .update(broadcasts)
      .set({
        status: "completed",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(broadcasts.id, broadcastId));

    log.info({ broadcastId, processed }, "Broadcast completed");
  }
}
