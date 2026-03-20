import { Worker } from "bullmq";
import { db } from "./db";
import { analyzeMessage } from "./services/ai-analysis";
import { updateContactProfile } from "./services/profile-updater";
import { resolveAIConfig } from "./services/ai-config-resolver";
import { evaluateWorkflows } from "./services/workflow-engine";
import { checkNoResponseTimeouts } from "./services/workflow-scheduler";
import type {
  AnalysisJobData,
  WorkflowJobData,
  TelegramOutgoingJobData,
  TelegramAutoReplyJobData,
  BroadcastProcessingJobData,
  BroadcastSendJobData,
  ScheduledMessageJobData,
} from "./queues";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("worker");

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");

const worker = new Worker<AnalysisJobData>(
  "message-analysis",
  async (job) => {
    const { creatorId, contactId, messageId, messageContent, platformType, conversationHistory } = job.data;

    log.info({ jobId: job.id, contactId }, "Processing message analysis");

    // Resolve AI config for analysis
    const config = await resolveAIConfig(db, creatorId, "analysis");
    if (!config) {
      log.warn({ creatorId }, "No AI config found, skipping analysis");
      return;
    }

    // Run analysis
    const analysis = await analyzeMessage(config, {
      message: messageContent,
      conversationHistory: conversationHistory.slice(-5) as { role: "fan" | "creator"; content: string }[],
      platformType,
    });

    // Update contact profile
    await updateContactProfile(db, contactId, messageId, analysis, creatorId);

    // Dispatch keyword_detected workflow event
    try {
      const { workflows: workflowsTable } = await import("@/server/db/schema");
      const { eq: eqOp, and: andOp } = await import("drizzle-orm");

      // Find active keyword workflows for this creator
      const keywordWorkflows = await db
        .select({ triggerConfig: workflowsTable.triggerConfig })
        .from(workflowsTable)
        .where(
          andOp(
            eqOp(workflowsTable.creatorId, creatorId),
            eqOp(workflowsTable.isActive, true),
            eqOp(workflowsTable.triggerType, "keyword_detected")
          )
        );

      if (keywordWorkflows.length > 0) {
        const allKeywords = new Set<string>();
        for (const wf of keywordWorkflows) {
          const config = wf.triggerConfig as { keywords?: string[] };
          if (config.keywords) {
            for (const kw of config.keywords) allKeywords.add(kw.toLowerCase());
          }
        }

        const lowerContent = messageContent.toLowerCase();
        const matched = [...allKeywords].filter((kw) => lowerContent.includes(kw));

        if (matched.length > 0) {
          const { workflowQueue: wfQueue } = await import("@/server/queues");
          await wfQueue.add("keyword_detected", {
            type: "keyword_detected",
            creatorId,
            contactId,
            conversationId: job.data.conversationId,
            messageContent,
            matchedKeywords: matched,
          });
        }
      }
    } catch (err) {
      log.warn({ err }, "Failed to check keyword workflows");
    }

    log.info({ jobId: job.id, contactId }, "Message analysis completed");
  },
  {
    connection: {
      host: redisUrl.hostname,
      port: Number(redisUrl.port) || 6379,
    },
    concurrency: 5,
    limiter: {
      max: 10,
      duration: 1000,
    },
  }
);

worker.on("completed", (job) => {
  log.debug({ jobId: job.id }, "Job completed");
});

worker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, err }, "Job failed");
});

worker.on("ready", () => {
  log.info("Worker ready and listening for jobs");
});

// --- Workflow evaluation worker ---

const workflowWorker = new Worker<WorkflowJobData>(
  "workflow-evaluation",
  async (job) => {
    log.info({ jobId: job.id, type: job.data.type }, "Processing workflow event");
    await evaluateWorkflows(db, job.data);
    log.info({ jobId: job.id, type: job.data.type }, "Workflow evaluation completed");
  },
  {
    connection: {
      host: redisUrl.hostname,
      port: Number(redisUrl.port) || 6379,
    },
    concurrency: 3,
  }
);

workflowWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, err }, "Workflow job failed");
});

workflowWorker.on("ready", () => {
  log.info("Workflow worker ready");
});

// --- Telegram outgoing worker ---

const telegramOutgoingWorker = new Worker<TelegramOutgoingJobData>(
  "telegram-outgoing",
  async (job) => {
    const { creatorId, chatId, text, conversationId, messageId } = job.data;
    log.info({ jobId: job.id, chatId }, "Sending Telegram message");

    const { eq } = await import("drizzle-orm");
    const { telegramBotConfigs, messages: messagesTable } = await import("@/server/db/schema");
    const { decrypt } = await import("@/lib/crypto");
    const { sendMessage } = await import("@/server/services/telegram");

    const config = await db.query.telegramBotConfigs.findFirst({
      where: eq(telegramBotConfigs.creatorId, creatorId),
    });

    if (!config) {
      log.warn({ creatorId }, "No Telegram config found, skipping send");
      return;
    }

    const token = decrypt(config.botToken);
    const result = await sendMessage(token, chatId, text);

    // Update message with external ID
    await db
      .update(messagesTable)
      .set({
        externalMessageId: String(result.message_id),
        source: "telegram",
      })
      .where(eq(messagesTable.id, messageId));

    log.info({ jobId: job.id, telegramMessageId: result.message_id }, "Telegram message sent");
  },
  {
    connection: {
      host: redisUrl.hostname,
      port: Number(redisUrl.port) || 6379,
    },
    concurrency: 5,
  }
);

telegramOutgoingWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, err }, "Telegram outgoing job failed");
});

telegramOutgoingWorker.on("ready", () => {
  log.info("Telegram outgoing worker ready");
});

// --- Telegram auto-reply worker ---

const telegramAutoReplyWorker = new Worker<TelegramAutoReplyJobData>(
  "telegram-auto-reply",
  async (job) => {
    const { creatorId, contactId, conversationId, chatId, messageContent } = job.data;
    log.info({ jobId: job.id, chatId }, "Processing Telegram auto-reply");

    const { eq } = await import("drizzle-orm");
    const { telegramBotConfigs, messages: messagesTable } = await import("@/server/db/schema");
    const { decrypt } = await import("@/lib/crypto");
    const { sendMessage } = await import("@/server/services/telegram");
    const { resolveAIConfig } = await import("@/server/services/ai-config-resolver");

    const config = await db.query.telegramBotConfigs.findFirst({
      where: eq(telegramBotConfigs.creatorId, creatorId),
    });

    if (!config || !config.autoReplyEnabled) {
      return;
    }

    // Get AI config
    const aiConfig = await resolveAIConfig(db, creatorId, "suggestion");
    if (!aiConfig) {
      log.warn({ creatorId }, "No AI config for auto-reply");
      return;
    }

    // Get recent conversation history
    const recentMessages = await db.query.messages.findMany({
      where: eq(messagesTable.conversationId, conversationId),
      orderBy: (m, { desc }) => [desc(m.createdAt)],
      limit: 10,
    });

    // Build a simple prompt for auto-reply
    const { callAIProvider } = await import("@/server/services/ai");
    const systemPrompt =
      "Eres un asistente de conversación para un creador de contenido en Telegram. " +
      "Responde de forma amigable y natural al mensaje del fan. " +
      "Sé conciso y conversacional. No reveles que eres una IA.";

    const conversationMsgs = recentMessages.reverse().map((m) => ({
      role: (m.role === "fan" ? "user" : "assistant") as "user" | "assistant",
      content: m.content,
    }));

    const result = await callAIProvider(aiConfig, systemPrompt, conversationMsgs, 512);

    if (!result.text) {
      return;
    }

    // Send via Telegram
    const token = decrypt(config.botToken);
    const tgResult = await sendMessage(token, chatId, result.text);

    // Save as creator message
    await db.insert(messagesTable).values({
      conversationId,
      role: "creator",
      content: result.text,
      aiSuggestion: result.text,
      aiSuggestionUsed: true,
      externalMessageId: String(tgResult.message_id),
      source: "telegram",
    });

    log.info({ jobId: job.id, chatId }, "Auto-reply sent");
  },
  {
    connection: {
      host: redisUrl.hostname,
      port: Number(redisUrl.port) || 6379,
    },
    concurrency: 3,
  }
);

telegramAutoReplyWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, err }, "Telegram auto-reply job failed");
});

telegramAutoReplyWorker.on("ready", () => {
  log.info("Telegram auto-reply worker ready");
});

// --- Broadcast processing worker ---

const broadcastProcessingWorker = new Worker<BroadcastProcessingJobData>(
  "broadcast-processing",
  async (job) => {
    const { broadcastId } = job.data;
    log.info({ jobId: job.id, broadcastId }, "Processing broadcast segment");

    try {
      const { processSegment } = await import("@/server/services/broadcast");
      await processSegment(db, broadcastId);
      log.info({ jobId: job.id, broadcastId }, "Broadcast processing completed");
    } catch (err) {
      log.error({ jobId: job.id, broadcastId, err }, "Broadcast processing failed");
      const { eq } = await import("drizzle-orm");
      const { broadcasts } = await import("@/server/db/schema");
      await db
        .update(broadcasts)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(broadcasts.id, broadcastId));
      throw err;
    }
  },
  {
    connection: {
      host: redisUrl.hostname,
      port: Number(redisUrl.port) || 6379,
    },
    concurrency: 2,
  }
);

broadcastProcessingWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, err }, "Broadcast processing job failed");
});

broadcastProcessingWorker.on("ready", () => {
  log.info("Broadcast processing worker ready");
});

// --- Broadcast send worker (rate limited for Telegram API) ---

const broadcastSendWorker = new Worker<BroadcastSendJobData>(
  "broadcast-send",
  async (job) => {
    const { recipientId } = job.data;
    log.info({ jobId: job.id, recipientId }, "Sending broadcast message");

    const { sendBroadcastMessage } = await import("@/server/services/broadcast-sender");
    await sendBroadcastMessage(db, recipientId);
  },
  {
    connection: {
      host: redisUrl.hostname,
      port: Number(redisUrl.port) || 6379,
    },
    concurrency: 10,
    limiter: {
      max: 30,
      duration: 1000,
    },
  }
);

broadcastSendWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, err }, "Broadcast send job failed");
});

broadcastSendWorker.on("ready", () => {
  log.info("Broadcast send worker ready");
});

// --- Scheduled message send worker ---

const scheduledMessageWorker = new Worker<ScheduledMessageJobData>(
  "scheduled-message-send",
  async (job) => {
    const { scheduledMessageId, creatorId } = job.data;
    log.info({ jobId: job.id, scheduledMessageId }, "Processing scheduled message");

    const { eq } = await import("drizzle-orm");
    const {
      scheduledMessages,
      messages: messagesTable,
      conversations,
      contacts,
    } = await import("@/server/db/schema");

    const scheduled = await db.query.scheduledMessages.findFirst({
      where: eq(scheduledMessages.id, scheduledMessageId),
    });

    if (!scheduled || scheduled.status !== "pending") {
      log.warn({ scheduledMessageId }, "Scheduled message not found or not pending, skipping");
      return;
    }

    try {
      // Insert as a real message
      const [message] = await db
        .insert(messagesTable)
        .values({
          conversationId: scheduled.conversationId,
          role: "creator",
          content: scheduled.content,
          aiSuggestion: scheduled.aiSuggestion,
          aiSuggestionUsed: scheduled.aiSuggestionUsed,
          sentById: scheduled.sentById,
        })
        .returning();

      // Update conversation lastMessageAt
      await db
        .update(conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversations.id, scheduled.conversationId));

      // Mark scheduled message as sent
      await db
        .update(scheduledMessages)
        .set({
          status: "sent",
          sentMessageId: message?.id,
          updatedAt: new Date(),
        })
        .where(eq(scheduledMessages.id, scheduledMessageId));

      // If conversation is on Telegram, enqueue outgoing message
      const conversation = await db.query.conversations.findFirst({
        where: eq(conversations.id, scheduled.conversationId),
        columns: { platformType: true, contactId: true },
      });

      if (conversation?.platformType === "telegram" && message) {
        const contact = await db.query.contacts.findFirst({
          where: eq(contacts.id, conversation.contactId),
          columns: { platformUserId: true },
        });

        if (contact?.platformUserId) {
          const { telegramOutgoingQueue } = await import("@/server/queues");
          await telegramOutgoingQueue.add("send", {
            creatorId,
            chatId: contact.platformUserId,
            text: scheduled.content,
            conversationId: scheduled.conversationId,
            messageId: message.id,
          });
        }
      }

      log.info({ jobId: job.id, scheduledMessageId }, "Scheduled message sent");
    } catch (err) {
      await db
        .update(scheduledMessages)
        .set({
          status: "failed",
          errorMessage: err instanceof Error ? err.message : "Unknown error",
          updatedAt: new Date(),
        })
        .where(eq(scheduledMessages.id, scheduledMessageId));
      throw err;
    }
  },
  {
    connection: {
      host: redisUrl.hostname,
      port: Number(redisUrl.port) || 6379,
    },
    concurrency: 5,
  }
);

scheduledMessageWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, err }, "Scheduled message job failed");
});

scheduledMessageWorker.on("ready", () => {
  log.info("Scheduled message worker ready");
});

// --- Periodic no_response_timeout checker (every 5 minutes) ---

async function checkScheduledMessagesToSend() {
  const { eq, and, lte } = await import("drizzle-orm");
  const { scheduledMessages } = await import("@/server/db/schema");
  const { scheduledMessageQueue } = await import("@/server/queues");

  const now = new Date();
  const pendingMessages = await db
    .select({ id: scheduledMessages.id, creatorId: scheduledMessages.creatorId })
    .from(scheduledMessages)
    .where(
      and(
        eq(scheduledMessages.status, "pending"),
        lte(scheduledMessages.scheduledAt, now)
      )
    );

  for (const msg of pendingMessages) {
    await scheduledMessageQueue.add("send", {
      scheduledMessageId: msg.id,
      creatorId: msg.creatorId,
    });
    log.info({ scheduledMessageId: msg.id }, "Scheduled message enqueued for sending");
  }
}

async function checkScheduledBroadcasts() {
  const { eq, and, lte } = await import("drizzle-orm");
  const { broadcasts } = await import("@/server/db/schema");
  const { broadcastProcessingQueue } = await import("@/server/queues");

  const now = new Date();
  const scheduledBroadcasts = await db
    .select({ id: broadcasts.id, creatorId: broadcasts.creatorId })
    .from(broadcasts)
    .where(
      and(
        eq(broadcasts.status, "scheduled"),
        lte(broadcasts.scheduledAt, now)
      )
    );

  for (const bc of scheduledBroadcasts) {
    await db
      .update(broadcasts)
      .set({ status: "processing", updatedAt: now })
      .where(eq(broadcasts.id, bc.id));

    await broadcastProcessingQueue.add("process", {
      broadcastId: bc.id,
      creatorId: bc.creatorId,
    });

    log.info({ broadcastId: bc.id }, "Scheduled broadcast triggered");
  }
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

async function startScheduler() {
  // Run immediately on startup, then every 5 minutes
  try {
    await checkNoResponseTimeouts(db);
  } catch (err) {
    log.error({ err }, "Error in initial no_response_timeout check");
  }

  schedulerInterval = setInterval(async () => {
    try {
      await checkNoResponseTimeouts(db);
    } catch (err) {
      log.error({ err }, "Error in no_response_timeout check");
    }

    // Check for scheduled broadcasts ready to send
    try {
      await checkScheduledBroadcasts();
    } catch (err) {
      log.error({ err }, "Error checking scheduled broadcasts");
    }

    // Check for scheduled messages ready to send
    try {
      await checkScheduledMessagesToSend();
    } catch (err) {
      log.error({ err }, "Error checking scheduled messages");
    }
  }, 5 * 60 * 1000);
}

startScheduler();

// Graceful shutdown
process.on("SIGTERM", async () => {
  log.info("SIGTERM received, closing workers...");
  if (schedulerInterval) clearInterval(schedulerInterval);
  await Promise.all([worker.close(), workflowWorker.close(), telegramOutgoingWorker.close(), telegramAutoReplyWorker.close(), broadcastProcessingWorker.close(), broadcastSendWorker.close(), scheduledMessageWorker.close()]);
  process.exit(0);
});

process.on("SIGINT", async () => {
  log.info("SIGINT received, closing workers...");
  if (schedulerInterval) clearInterval(schedulerInterval);
  await Promise.all([worker.close(), workflowWorker.close(), telegramOutgoingWorker.close(), telegramAutoReplyWorker.close(), broadcastProcessingWorker.close(), broadcastSendWorker.close(), scheduledMessageWorker.close()]);
  process.exit(0);
});
