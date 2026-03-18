import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/server/db";
import {
  telegramBotConfigs,
  contacts,
  conversations,
  messages,
} from "@/server/db/schema";
import { decrypt } from "@/lib/crypto";
import { analysisQueue, telegramAutoReplyQueue } from "@/server/queues";
import { workflowQueue } from "@/server/queues";
import type { TelegramUpdate } from "@/server/services/telegram";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("telegram-webhook");

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ secret: string }> }
) {
  const { secret } = await params;

  // Validate the webhook secret header
  const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
  if (secretHeader !== secret) {
    log.warn("Invalid webhook secret header");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find bot config by webhook secret
  const config = await db.query.telegramBotConfigs.findFirst({
    where: eq(telegramBotConfigs.webhookSecret, secret),
  });

  if (!config) {
    log.warn({ secret: secret.slice(0, 8) }, "No bot config found for secret");
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // We only handle text messages for now
  const msg = update.message;
  if (!msg?.text || !msg.from) {
    return NextResponse.json({ ok: true });
  }

  const chatId = msg.chat.id;
  const telegramUserId = String(msg.from.id);
  const username = msg.from.username ?? msg.from.first_name ?? `user_${telegramUserId}`;
  const displayName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || username;
  const messageText = msg.text;

  try {
    // Find or create contact
    let contact = await db.query.contacts.findFirst({
      where: and(
        eq(contacts.creatorId, config.creatorId),
        eq(contacts.platformType, "telegram"),
        eq(contacts.platformUserId, telegramUserId)
      ),
    });

    let isNewContact = false;

    if (!contact) {
      isNewContact = true;
      const [newContact] = await db
        .insert(contacts)
        .values({
          creatorId: config.creatorId,
          platformType: "telegram",
          username,
          displayName,
          platformUserId: telegramUserId,
        })
        .returning();
      contact = newContact!;

      // Dispatch new_contact workflow event
      await workflowQueue
        .add("new_contact", {
          type: "new_contact",
          creatorId: config.creatorId,
          contactId: contact.id,
          platformType: "telegram",
        })
        .catch((err) => log.warn({ err }, "Failed to enqueue new_contact workflow"));
    }

    // Find or create conversation
    let conversation = await db.query.conversations.findFirst({
      where: and(
        eq(conversations.creatorId, config.creatorId),
        eq(conversations.contactId, contact.id),
        eq(conversations.status, "active")
      ),
    });

    if (!conversation) {
      const [newConv] = await db
        .insert(conversations)
        .values({
          creatorId: config.creatorId,
          contactId: contact.id,
          platformType: "telegram",
          status: "active",
          lastMessageAt: new Date(),
        })
        .returning();
      conversation = newConv!;
    }

    // Store the incoming message
    const [savedMessage] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        role: "fan",
        content: messageText,
        externalMessageId: String(msg.message_id),
        source: "telegram",
      })
      .returning();

    // Update timestamps
    await db
      .update(conversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(conversations.id, conversation.id));

    await db
      .update(contacts)
      .set({
        lastInteractionAt: new Date(),
        totalConversations: contact.totalConversations + 1,
      })
      .where(eq(contacts.id, contact.id));

    // Enqueue analysis
    if (savedMessage) {
      const recentMessages = await db.query.messages.findMany({
        where: eq(messages.conversationId, conversation.id),
        orderBy: (m, { desc }) => [desc(m.createdAt)],
        limit: 5,
      });

      await analysisQueue
        .add("analyze", {
          creatorId: config.creatorId,
          contactId: contact.id,
          messageId: savedMessage.id,
          conversationId: conversation.id,
          messageContent: messageText,
          platformType: "telegram",
          conversationHistory: recentMessages.reverse().map((m) => ({
            role: m.role,
            content: m.content,
          })),
        })
        .catch((err) => log.warn({ err }, "Failed to enqueue analysis"));
    }

    // Send welcome message for new contacts
    if (isNewContact && config.welcomeMessage) {
      const token = decrypt(config.botToken);
      const { sendMessage } = await import("@/server/services/telegram");
      await sendMessage(token, chatId, config.welcomeMessage).catch((err) =>
        log.warn({ err }, "Failed to send welcome message")
      );
    }

    // Enqueue auto-reply if enabled
    if (config.autoReplyEnabled && savedMessage) {
      await telegramAutoReplyQueue
        .add(
          "auto-reply",
          {
            creatorId: config.creatorId,
            contactId: contact.id,
            conversationId: conversation.id,
            chatId: String(chatId),
            messageContent: messageText,
          },
          {
            delay: config.autoReplyDelaySec * 1000,
          }
        )
        .catch((err) => log.warn({ err }, "Failed to enqueue auto-reply"));
    }

    log.info(
      { creatorId: config.creatorId, contactId: contact.id, chatId },
      "Telegram message processed"
    );
  } catch (err) {
    log.error({ err, chatId }, "Error processing Telegram message");

    // Send error message if configured
    if (config.errorMessage) {
      try {
        const token = decrypt(config.botToken);
        const { sendMessage } = await import("@/server/services/telegram");
        await sendMessage(token, chatId, config.errorMessage);
      } catch {
        // Ignore
      }
    }
  }

  // Always return 200 to Telegram
  return NextResponse.json({ ok: true });
}
