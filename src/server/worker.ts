import { Worker } from "bullmq";
import { db } from "./db";
import { analyzeMessage } from "./services/ai-analysis";
import { updateContactProfile } from "./services/profile-updater";
import { resolveAIConfig } from "./services/ai-config-resolver";
import { evaluateWorkflows } from "./services/workflow-engine";
import { checkNoResponseTimeouts, checkInactivityFollowups } from "./services/workflow-scheduler";
import type {
  AnalysisJobData,
  WorkflowJobData,
  TelegramOutgoingJobData,
  TelegramAutoReplyJobData,
  BroadcastProcessingJobData,
  BroadcastSendJobData,
  ScheduledMessageJobData,
  ImportJobData,
  EmailJobData,
  SequenceJobData,
  WebhookDeliveryJobData,
  ScheduledPostJobData,
} from "./queues";
import { deliverWebhook, dispatchWebhookEvent } from "./services/webhook-dispatcher";
import { importJobs, contactProfiles } from "./db/schema";
import { createChildLogger } from "@/lib/logger";
import { publishEvent } from "@/lib/redis-pubsub";

const log = createChildLogger("worker");

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");

const worker = new Worker<AnalysisJobData>(
  "message-analysis",
  async (job) => {
    const { creatorId, contactId, messageId, conversationId, messageContent, platformType, conversationHistory, source = "message" } = job.data;

    log.info({ jobId: job.id, contactId, source }, "Processing message analysis");

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

    // Update contact profile, routing the sentiment write to the correct table
    await updateContactProfile(
      db,
      contactId,
      { type: source, id: messageId },
      analysis,
      creatorId
    );

    // Dispatch webhook for messages only (comments use comment.received on ingestion)
    if (source === "message") {
      dispatchWebhookEvent(db, creatorId, "message.received", {
        contactId,
        conversationId,
        messageId,
        sentiment: analysis.score,
        topics: analysis.topics,
      }).catch(() => {});
    }

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

    // Auto-response features: classification + quick replies
    try {
      const { autoResponseConfigs: arConfigsTable, messages: msgsTable, conversations: convsTable } = await import("@/server/db/schema");
      const { eq: eqOp, and: andOp } = await import("drizzle-orm");

      // Find auto-response config for this platform
      const arConfig = await db.query.autoResponseConfigs.findFirst({
        where: andOp(
          eqOp(arConfigsTable.creatorId, creatorId),
          eqOp(arConfigsTable.platformType, platformType as "instagram" | "tinder" | "reddit" | "onlyfans" | "twitter" | "telegram" | "snapchat" | "other"),
          eqOp(arConfigsTable.isEnabled, true)
        ),
      });

      if (arConfig) {
        // Classification
        if (arConfig.classifyMessages && config) {
          try {
            const { classifyMessage } = await import("@/server/services/message-classifier");
            const classification = await classifyMessage(config, messageContent, platformType);

            // Store classification in sentiment JSONB
            const msg = await db.query.messages.findFirst({
              where: eqOp(msgsTable.id, messageId),
              columns: { sentiment: true },
            });
            const existingSentiment = (msg?.sentiment as Record<string, unknown>) ?? {};
            await db
              .update(msgsTable)
              .set({
                sentiment: { ...existingSentiment, classification },
              })
              .where(eqOp(msgsTable.id, messageId));

            log.info({ messageId, category: classification.category }, "Message classified");

            // Dispatch workflow event for non-general classifications
            if (classification.category !== "general" && classification.confidence >= 0.7) {
              const { workflowQueue: wfQueue } = await import("@/server/queues");
              await wfQueue.add("message_classified", {
                type: "keyword_detected", // Reuse workflow type since enum not extended yet
                creatorId,
                contactId,
                conversationId: job.data.conversationId,
                messageContent,
                matchedKeywords: [classification.category],
              });
            }
          } catch (classErr) {
            log.warn({ classErr }, "Message classification failed");
          }
        }

        // Pre-generate quick replies
        if (arConfig.preGenerateReplies && config) {
          try {
            const { generateQuickReplies } = await import("@/server/services/quick-replies");

            const contact = await db.query.contacts.findFirst({
              where: eqOp((await import("@/server/db/schema")).contacts.id, contactId),
              with: { profile: true },
            });

            const replies = await generateQuickReplies(config, {
              message: messageContent,
              platformType,
              contactProfile: contact?.profile
                ? {
                    funnelStage: contact.profile.funnelStage,
                    engagementLevel: contact.profile.engagementLevel,
                  }
                : undefined,
            });

            if (replies.length > 0) {
              await db
                .update(msgsTable)
                .set({ aiSuggestion: replies.join("\n---\n") })
                .where(eqOp(msgsTable.id, messageId));

              log.info({ messageId, replyCount: replies.length }, "Quick replies pre-generated");
            }
          } catch (qrErr) {
            log.warn({ qrErr }, "Quick reply generation failed");
          }
        }
      }
    } catch (arErr) {
      log.warn({ arErr }, "Auto-response processing failed");
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
    const [autoMsg] = await db.insert(messagesTable).values({
      conversationId,
      role: "creator",
      content: result.text,
      aiSuggestion: result.text,
      aiSuggestionUsed: true,
      externalMessageId: String(tgResult.message_id),
      source: "telegram",
    }).returning();

    if (autoMsg) {
      publishEvent(creatorId, {
        type: "new_message",
        data: { conversationId, messageId: autoMsg.id, role: "creator", source: "auto-reply" },
      }).catch(() => {});
    }

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

      // Publish real-time event
      if (message) {
        publishEvent(creatorId, {
          type: "new_message",
          data: { conversationId: scheduled.conversationId, messageId: message.id, role: "creator", source: "scheduled" },
        }).catch(() => {});
      }

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
let churnCheckCounter = 0;
let inactivityFollowupCounter = 0;

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

    // Check sequence steps due for execution
    try {
      const { checkSequenceSteps } = await import("@/server/services/sequence-engine");
      await checkSequenceSteps(db);
    } catch (err) {
      log.error({ err }, "Error checking sequence steps");
    }

    // Poll Reddit for new comments on tracked posts
    try {
      const { pollRedditComments } = await import(
        "@/server/services/reddit-poller"
      );
      await pollRedditComments(db);
    } catch (err) {
      log.error({ err }, "Error polling Reddit comments");
    }

    // Poll Twitter for new replies on tracked tweets
    try {
      const { pollTwitterComments } = await import(
        "@/server/services/twitter-poller"
      );
      await pollTwitterComments(db);
    } catch (err) {
      log.error({ err }, "Error polling Twitter comments");
    }

    // Reconcile Twitter filtered stream rules with the tracked posts.
    // No-op when TWITTER_BEARER_TOKEN is not set.
    try {
      const { syncStreamRules } = await import(
        "@/server/services/twitter-stream-rules"
      );
      await syncStreamRules(db);
    } catch (err) {
      log.error({ err }, "Error syncing Twitter stream rules");
    }

    // Inactivity followup enrollment every 30 min (every 6th interval of 5 min)
    inactivityFollowupCounter++;
    if (inactivityFollowupCounter >= 6) {
      inactivityFollowupCounter = 0;
      try {
        await checkInactivityFollowups(db);
      } catch (err) {
        log.error({ err }, "Error checking inactivity followups");
      }
    }

    // Batch churn recalculation every 6 hours (every 72nd interval of 5 min)
    churnCheckCounter++;
    if (churnCheckCounter >= 72) {
      churnCheckCounter = 0;
      try {
        const { computeAllChurnScores } = await import("@/server/services/churn-prediction");
        await computeAllChurnScores(db);
      } catch (err) {
        log.error({ err }, "Error in batch churn recalculation");
      }
    }
  }, 5 * 60 * 1000);
}

// --- Contact Import Worker ---

const PLATFORM_TYPES_SET = new Set([
  "instagram", "tinder", "reddit", "onlyfans", "twitter", "telegram", "snapchat", "other",
]);

const importWorker = new Worker<ImportJobData>(
  "contact-import",
  async (job) => {
    const { importJobId, creatorId } = job.data;
    log.info({ jobId: job.id, importJobId }, "Processing contact import");

    const { contacts } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");

    try {
      const importJob = await db.query.importJobs.findFirst({
        where: eq(importJobs.id, importJobId),
      });

      if (!importJob || importJob.status === "cancelled") {
        log.info({ importJobId }, "Import job not found or cancelled");
        return;
      }

      const rawData = importJob.rawData as { headers: string[]; rows: string[][] };
      const mapping = importJob.columnMapping as Record<string, string | null>;
      const skipDuplicates = importJob.skipDuplicates;

      // Build existing contacts set for duplicate detection
      const existingContacts = await db.query.contacts.findMany({
        where: eq(contacts.creatorId, creatorId),
        columns: { username: true, platformType: true },
      });
      const existingSet = new Set(
        existingContacts.map((c) => `${c.username.toLowerCase()}:${c.platformType}`)
      );

      // Find header indices for mapped fields
      const fieldIndices: Record<string, number> = {};
      for (const [header, field] of Object.entries(mapping)) {
        if (field) {
          const idx = rawData.headers.indexOf(header);
          if (idx >= 0) fieldIndices[field] = idx;
        }
      }

      let createdCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      let duplicateCount = 0;
      const errors: { row: number; message: string }[] = [];
      const BATCH_SIZE = 50;

      for (let i = 0; i < rawData.rows.length; i += BATCH_SIZE) {
        // Check if cancelled
        const currentJob = await db.query.importJobs.findFirst({
          where: eq(importJobs.id, importJobId),
          columns: { status: true },
        });
        if (currentJob?.status === "cancelled") break;

        const batch = rawData.rows.slice(i, i + BATCH_SIZE);

        for (let j = 0; j < batch.length; j++) {
          const row = batch[j]!;
          const rowNum = i + j + 1;

          try {
            const username = fieldIndices.username != null ? row[fieldIndices.username]?.trim() : undefined;
            const platformType = fieldIndices.platformType != null ? row[fieldIndices.platformType]?.trim().toLowerCase() : undefined;
            const displayName = fieldIndices.displayName != null ? row[fieldIndices.displayName]?.trim() : undefined;
            const tags = fieldIndices.tags != null ? row[fieldIndices.tags]?.split(";").map((t) => t.trim()).filter(Boolean) : undefined;
            const platformUserId = fieldIndices.platformUserId != null ? row[fieldIndices.platformUserId]?.trim() : undefined;

            // Validate required fields
            if (!username || username.length === 0 || username.length > 255) {
              errors.push({ row: rowNum, message: "Username invalido o vacio" });
              errorCount++;
              continue;
            }

            if (!platformType || !PLATFORM_TYPES_SET.has(platformType)) {
              errors.push({ row: rowNum, message: `Plataforma invalida: ${platformType ?? "vacio"}` });
              errorCount++;
              continue;
            }

            // Duplicate check
            const key = `${username.toLowerCase()}:${platformType}`;
            if (existingSet.has(key)) {
              duplicateCount++;
              if (skipDuplicates) {
                skippedCount++;
                continue;
              }
            }

            // Insert contact + profile
            const [newContact] = await db
              .insert(contacts)
              .values({
                creatorId,
                username,
                displayName: displayName || null,
                platformType: platformType as "instagram" | "tinder" | "reddit" | "onlyfans" | "twitter" | "telegram" | "snapchat" | "other",
                tags: tags ?? [],
                platformUserId: platformUserId || null,
              })
              .returning({ id: contacts.id });

            if (newContact) {
              await db.insert(contactProfiles).values({
                contactId: newContact.id,
              });
              existingSet.add(key); // Prevent duplicates within same import
              createdCount++;
            }
          } catch (err) {
            errors.push({ row: rowNum, message: String(err) });
            errorCount++;
          }
        }

        // Update progress
        await db
          .update(importJobs)
          .set({
            processedRows: Math.min(i + BATCH_SIZE, rawData.rows.length),
            createdCount,
            skippedCount,
            errorCount,
            duplicateCount,
            errors: errors.slice(-100), // Keep last 100 errors
          })
          .where(eq(importJobs.id, importJobId));
      }

      // Finalize
      await db
        .update(importJobs)
        .set({
          status: "completed",
          processedRows: rawData.rows.length,
          createdCount,
          skippedCount,
          errorCount,
          duplicateCount,
          errors: errors.slice(-100),
          completedAt: new Date(),
        })
        .where(eq(importJobs.id, importJobId));

      // Publish real-time event
      publishEvent(creatorId, {
        type: "conversation_update",
        data: { importJobId, status: "completed", createdCount },
      });

      log.info({ importJobId, createdCount, skippedCount, errorCount, duplicateCount }, "Import completed");
    } catch (err) {
      log.error({ err, importJobId }, "Import job failed");
      const { eq } = await import("drizzle-orm");
      await db
        .update(importJobs)
        .set({ status: "failed" })
        .where(eq(importJobs.id, importJobId));
    }
  },
  { connection: { host: redisUrl.hostname, port: Number(redisUrl.port) || 6379 }, concurrency: 2 }
);

importWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, err: err.message }, "Import worker job failed");
});

// --- Sequence Worker ---

const sequenceWorker = new Worker<SequenceJobData>(
  "sequence-processing",
  async (job) => {
    const { type } = job.data;
    log.info({ jobId: job.id, type }, "Processing sequence job");

    const { enrollContact, processSequenceStep } = await import("@/server/services/sequence-engine");

    switch (type) {
      case "process_step":
        await processSequenceStep(db, job.data.enrollmentId);
        break;
      case "enroll":
        await enrollContact(db, job.data.sequenceId, job.data.contactId, job.data.creatorId);
        break;
      default:
        log.warn({ type }, "Unknown sequence job type");
    }
  },
  { connection: { host: redisUrl.hostname, port: Number(redisUrl.port) || 6379 }, concurrency: 3 }
);

sequenceWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, err: err.message }, "Sequence worker job failed");
});

sequenceWorker.on("ready", () => {
  log.info("Sequence worker ready");
});

// --- Webhook Delivery Worker ---

const webhookDeliveryWorker = new Worker<WebhookDeliveryJobData>(
  "webhook-delivery",
  async (job) => {
    const { webhookConfigId, event, payload, url, secret } = job.data;
    await deliverWebhook(db, webhookConfigId, event, payload, url, secret, job.attemptsMade + 1);
  },
  {
    connection: { host: redisUrl.hostname, port: Number(redisUrl.port) || 6379 },
    concurrency: 5,
  }
);

webhookDeliveryWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, err: err.message }, "Webhook delivery job failed");
});

webhookDeliveryWorker.on("ready", () => {
  log.info("Webhook delivery worker ready");
});

// --- Email Worker ---

const emailWorker = new Worker<EmailJobData>(
  "email-send",
  async (job) => {
    const { type, to, data } = job.data;
    log.info({ jobId: job.id, type, to }, "Processing email job");

    const email = await import("@/server/services/email");

    switch (type) {
      case "verification":
        await email.sendVerificationEmail(to, data.verifyUrl as string);
        break;
      case "password_reset":
        await email.sendPasswordResetEmail(to, data.resetUrl as string);
        break;
      case "daily_summary":
        await email.sendDailySummary(to, data as unknown as import("@/server/services/email").DailySummaryData);
        break;
      case "weekly_summary":
        await email.sendWeeklySummary(to, data as unknown as import("@/server/services/email").WeeklySummaryData);
        break;
      case "churn_alert":
        await email.sendChurnAlert(to, data as unknown as import("@/server/services/email").ChurnAlertData);
        break;
      default:
        log.warn({ type }, "Unknown email job type");
    }
  },
  { connection: { host: redisUrl.hostname, port: Number(redisUrl.port) || 6379 }, concurrency: 5 }
);

emailWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, err: err.message }, "Email worker job failed");
});

// --- Email Summary Scheduler ---

let summarySchedulerInterval: ReturnType<typeof setInterval> | null = null;

async function startSummaryScheduler() {
  const redis = (await import("ioredis")).default;
  const redisClient = new redis(process.env.REDIS_URL ?? "redis://localhost:6379");

  summarySchedulerInterval = setInterval(async () => {
    const now = new Date();
    const hour = now.getUTCHours();

    if (hour !== 9) return; // Only run at 9 UTC

    const { checkAndSendDailySummaries, checkAndSendWeeklySummaries } = await import("@/server/services/email-summary");

    // Daily summary (dedup by date)
    const dailyKey = `summary:daily:${now.toISOString().slice(0, 10)}`;
    const dailySent = await redisClient.set(dailyKey, "1", "EX", 86400, "NX");
    if (dailySent) {
      try {
        await checkAndSendDailySummaries(db);
      } catch (err) {
        log.error({ err }, "Error sending daily summaries");
      }
    }

    // Weekly summary (Mondays only, dedup by week)
    if (now.getUTCDay() === 1) {
      const weekNum = Math.ceil(((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000 + 1) / 7);
      const weeklyKey = `summary:weekly:${now.getFullYear()}-W${weekNum}`;
      const weeklySent = await redisClient.set(weeklyKey, "1", "EX", 604800, "NX");
      if (weeklySent) {
        try {
          await checkAndSendWeeklySummaries(db);
        } catch (err) {
          log.error({ err }, "Error sending weekly summaries");
        }
      }
    }
  }, 60 * 60 * 1000); // Every hour
}

// --- Scheduled post publishing worker ---

const scheduledPostWorker = new Worker<ScheduledPostJobData>(
  "scheduled-post-publish",
  async (job) => {
    const { scheduledPostId, creatorId } = job.data;
    log.info({ jobId: job.id, scheduledPostId }, "Processing scheduled post");

    const { eq, and } = await import("drizzle-orm");
    const { scheduledPosts, socialAccounts } = await import(
      "./db/schema"
    );
    const { publishToReddit } = await import(
      "./services/scheduler-publisher"
    );

    const post = await db.query.scheduledPosts.findFirst({
      where: eq(scheduledPosts.id, scheduledPostId),
    });

    if (!post) {
      log.warn({ scheduledPostId }, "Scheduled post not found, skipping");
      return;
    }
    if (post.status !== "scheduled" && post.status !== "failed") {
      log.warn(
        { scheduledPostId, status: post.status },
        "Scheduled post not in publishable state, skipping"
      );
      return;
    }

    await db
      .update(scheduledPosts)
      .set({
        status: "processing",
        attempts: post.attempts + 1,
        updatedAt: new Date(),
      })
      .where(eq(scheduledPosts.id, scheduledPostId));

    const externalIds: Record<string, { id?: string; url?: string }> = {
      ...((post.externalPostIds as Record<string, { id?: string; url?: string }>) ?? {}),
    };
    const errors: Record<string, string> = {};
    let successCount = 0;

    for (const platform of post.targetPlatforms) {
      // Multi-account: prefer the explicit accountId from platformConfigs,
      // otherwise fall back to the first active account on that platform.
      const platformCfg =
        ((post.platformConfigs as Record<string, unknown>)?.[platform] ?? {}) as {
          accountId?: string;
        };

      const accountConditions = [
        eq(socialAccounts.creatorId, creatorId),
        eq(socialAccounts.platformType, platform as "reddit"),
        eq(socialAccounts.isActive, true),
      ];
      if (platformCfg.accountId) {
        accountConditions.push(eq(socialAccounts.id, platformCfg.accountId));
      }

      const account = await db.query.socialAccounts.findFirst({
        where: and(...accountConditions),
      });

      if (!account) {
        errors[platform] = platformCfg.accountId
          ? `Account ${platformCfg.accountId} not found or inactive`
          : "No active account configured";
        dispatchWebhookEvent(db, creatorId, "post.failed", {
          scheduledPostId,
          platform,
          error: errors[platform],
        }).catch(() => {});
        continue;
      }

      if (account.connectionType === "webhook") {
        // Route C: dispatch webhook with full payload for Zapier/Make to publish
        await dispatchWebhookEvent(db, creatorId, "post.publishing", {
          scheduledPostId,
          platform,
          title: post.title,
          content: post.content,
          mediaUrls: post.mediaUrls ?? [],
          platformConfig:
            (post.platformConfigs as Record<string, unknown>)?.[platform] ?? {},
        });
        externalIds[platform] = { id: "webhook-dispatched" };
        successCount++;
        continue;
      }

      // Native publishers
      if (platform === "reddit") {
        const cfg = ((post.platformConfigs as Record<string, unknown>)?.reddit ??
          {}) as {
            subreddit?: string;
            flairId?: string;
            nsfw?: boolean;
            spoiler?: boolean;
            kind?: "self" | "link" | "image";
            url?: string;
          };
        if (!cfg.subreddit) {
          errors[platform] = "Missing subreddit in platform config";
          continue;
        }
        if (!account.encryptedCredentials) {
          errors[platform] = "Account has no stored credentials";
          continue;
        }
        const result = await publishToReddit(
          account.encryptedCredentials,
          {
            title: post.title ?? "(untitled)",
            content: post.content,
            subreddit: cfg.subreddit,
            kind: cfg.kind ?? "self",
            url: cfg.url,
            flairId: cfg.flairId,
            nsfw: cfg.nsfw,
            spoiler: cfg.spoiler,
          },
          creatorId
        );
        if (result.success) {
          externalIds[platform] = {
            id: result.externalId,
            url: result.externalUrl,
          };
          successCount++;

          // Sync to socialPosts so the comment poller picks up replies on
          // this submission. Skip silently if duplicate (unique index).
          if (result.externalId) {
            try {
              const { socialPosts: socialPostsTable } = await import(
                "./db/schema"
              );
              await db
                .insert(socialPostsTable)
                .values({
                  creatorId,
                  platformType: "reddit",
                  externalPostId: result.externalId,
                  url: result.externalUrl ?? null,
                  title: post.title ?? null,
                  content: post.content,
                  publishedAt: new Date(),
                })
                .onConflictDoNothing();
            } catch (syncErr) {
              log.warn(
                { syncErr, scheduledPostId },
                "Failed to sync scheduled post to social_posts (non-critical)"
              );
            }
          }

          dispatchWebhookEvent(db, creatorId, "post.published", {
            scheduledPostId,
            platform,
            externalId: result.externalId,
            externalUrl: result.externalUrl,
          }).catch(() => {});
        } else {
          errors[platform] = result.error ?? "Unknown error";
          dispatchWebhookEvent(db, creatorId, "post.failed", {
            scheduledPostId,
            platform,
            error: errors[platform],
          }).catch(() => {});
        }
      } else if (platform === "twitter") {
        if (!account.encryptedOauthAccessToken) {
          errors[platform] = "Twitter account not connected via OAuth";
          continue;
        }
        const { publishToTwitter, ensureFreshTwitterToken } = await import(
          "./services/twitter-publisher"
        );
        try {
          const refreshed = await ensureFreshTwitterToken({
            encryptedAccess: account.encryptedOauthAccessToken,
            encryptedRefresh: account.encryptedOauthRefreshToken,
            expiresAt: account.oauthExpiresAt,
          });
          if (refreshed.refreshed) {
            // Persist refreshed tokens
            const { socialAccounts: saTable } = await import("./db/schema");
            await db
              .update(saTable)
              .set({
                encryptedOauthAccessToken: refreshed.newAccessEncrypted,
                encryptedOauthRefreshToken: refreshed.newRefreshEncrypted,
                oauthExpiresAt: refreshed.newExpiresAt,
                updatedAt: new Date(),
              })
              .where(eq(saTable.id, account.id));
          }

          const twitterCfg = ((post.platformConfigs as Record<string, unknown>)?.twitter ?? {}) as {
            tweet?: string;
            thread?: string[];
          };
          const tweetText = twitterCfg.tweet ?? post.content;
          const thread = twitterCfg.thread ?? [];

          const result = await publishToTwitter({
            accessToken: refreshed.accessToken,
            tweet: tweetText.slice(0, 270),
            thread: thread.map((t) => t.slice(0, 270)),
            username: account.accountUsername ?? undefined,
          });
          if (result.success) {
            externalIds[platform] = {
              id: result.externalId,
              url: result.externalUrl,
            };
            successCount++;

            // Mirror to socialPosts so the Twitter comment poller monitors
            // this tweet for replies. Unique index dedupes on retries.
            let mirroredSocialPostId: string | null = null;
            try {
              const { socialPosts: socialPostsTable } = await import(
                "./db/schema"
              );
              const [mirrored] = await db
                .insert(socialPostsTable)
                .values({
                  creatorId,
                  platformType: "twitter",
                  externalPostId: result.externalId,
                  url: result.externalUrl ?? null,
                  title: null,
                  content: post.content,
                  publishedAt: new Date(),
                })
                .onConflictDoNothing()
                .returning({ id: socialPostsTable.id });
              mirroredSocialPostId = mirrored?.id ?? null;
            } catch (syncErr) {
              log.warn(
                { syncErr, scheduledPostId },
                "Failed to sync tweet to social_posts (non-critical)"
              );
            }

            // If filtered stream is enabled, register a rule right away so we
            // start receiving replies in real time (vs waiting for the 5-min
            // sync tick).
            if (mirroredSocialPostId && result.externalId) {
              try {
                const { addStreamRuleForPost, getBearerToken } = await import(
                  "./services/twitter-stream-rules"
                );
                if (getBearerToken()) {
                  await addStreamRuleForPost(db, {
                    creatorId,
                    postId: mirroredSocialPostId,
                    externalPostId: result.externalId,
                  });
                }
              } catch (ruleErr) {
                log.warn(
                  { ruleErr, scheduledPostId },
                  "Failed to add Twitter stream rule (non-critical)"
                );
              }
            }

            dispatchWebhookEvent(db, creatorId, "post.published", {
              scheduledPostId,
              platform,
              externalId: result.externalId,
              externalUrl: result.externalUrl,
              threadIds: result.threadIds,
            }).catch(() => {});
          } else {
            errors[platform] = result.error;
            dispatchWebhookEvent(db, creatorId, "post.failed", {
              scheduledPostId,
              platform,
              error: result.error,
            }).catch(() => {});
          }
        } catch (twErr) {
          errors[platform] = (twErr as Error).message;
        }
      } else if (platform === "instagram") {
        if (!account.encryptedOauthAccessToken || !account.externalAccountId) {
          errors[platform] = "Instagram account not connected via OAuth";
          continue;
        }
        const { decrypt } = await import("@/lib/crypto");
        const { publishToInstagram } = await import(
          "./services/instagram-publisher"
        );
        try {
          const accessToken = decrypt(account.encryptedOauthAccessToken);
          const igCfg = ((post.platformConfigs as Record<string, unknown>)?.instagram ?? {}) as {
            imageUrl?: string;
          };
          if (!igCfg.imageUrl) {
            errors[platform] =
              "Instagram requires an imageUrl in platformConfigs.instagram";
            continue;
          }
          const result = await publishToInstagram({
            accessToken,
            igUserId: account.externalAccountId,
            imageUrl: igCfg.imageUrl,
            caption: post.content,
          });
          if (result.success) {
            externalIds[platform] = {
              id: result.externalId,
              url: result.externalUrl,
            };
            successCount++;
            dispatchWebhookEvent(db, creatorId, "post.published", {
              scheduledPostId,
              platform,
              externalId: result.externalId,
              externalUrl: result.externalUrl,
            }).catch(() => {});
          } else {
            errors[platform] = result.error;
            dispatchWebhookEvent(db, creatorId, "post.failed", {
              scheduledPostId,
              platform,
              error: result.error,
            }).catch(() => {});
          }
        } catch (igErr) {
          errors[platform] = (igErr as Error).message;
        }
      } else {
        errors[platform] = `Native publisher not implemented for ${platform}`;
      }
    }

    const totalPlatforms = post.targetPlatforms.length;
    const baseStatus =
      successCount === totalPlatforms
        ? "posted"
        : successCount === 0
        ? "failed"
        : "partial";

    // Recurrence: if the post has a rule and the next occurrence is still
    // valid, re-arm it for the next slot rather than marking it complete.
    let finalStatus: typeof baseStatus | "scheduled" = baseStatus;
    let nextScheduleAt: Date | null = null;
    let nextJobId: string | null = null;

    const rule = post.recurrenceRule as
      | import("./services/recurrence").RecurrenceRule
      | null;

    if (rule && successCount > 0) {
      try {
        const { computeNextOccurrence } = await import(
          "./services/recurrence"
        );
        const nextOccurrencesSoFar = (post.recurrenceCount ?? 0) + 1;
        nextScheduleAt = computeNextOccurrence(
          rule,
          new Date(),
          nextOccurrencesSoFar
        );
        if (nextScheduleAt) {
          const { scheduledPostQueue: queue } = await import("./queues");
          const delay = Math.max(0, nextScheduleAt.getTime() - Date.now());
          const nextJob = await queue.add(
            "publish",
            { scheduledPostId, creatorId },
            { delay }
          );
          nextJobId = nextJob.id ?? null;
          finalStatus = "scheduled";
        }
      } catch (recurErr) {
        log.error(
          { recurErr, scheduledPostId },
          "Failed to schedule next recurrence (non-fatal)"
        );
      }
    }

    await db
      .update(scheduledPosts)
      .set({
        status: finalStatus,
        externalPostIds: externalIds,
        lastError:
          Object.keys(errors).length > 0 ? JSON.stringify(errors) : null,
        publishedAt: successCount > 0 ? new Date() : null,
        scheduleAt: nextScheduleAt ?? post.scheduleAt,
        recurrenceCount: rule
          ? (post.recurrenceCount ?? 0) + 1
          : post.recurrenceCount,
        jobId: nextJobId ?? post.jobId,
        attempts: nextScheduleAt ? 0 : post.attempts + 0,
        updatedAt: new Date(),
      })
      .where(eq(scheduledPosts.id, scheduledPostId));

    log.info(
      {
        jobId: job.id,
        scheduledPostId,
        finalStatus,
        successCount,
        totalPlatforms,
        nextScheduleAt,
      },
      "Scheduled post processed"
    );

    if (baseStatus === "failed" || baseStatus === "partial") {
      throw new Error(
        `Publishing finished with status=${baseStatus}: ${JSON.stringify(errors)}`
      );
    }
  },
  {
    connection: {
      host: redisUrl.hostname,
      port: Number(redisUrl.port) || 6379,
    },
    concurrency: 3,
  }
);

scheduledPostWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, err }, "Scheduled post job failed");
});

startScheduler();
startSummaryScheduler();

// Start the Twitter filtered stream worker if a bearer token is configured.
// Safe no-op otherwise; the polling fallback in startScheduler keeps working.
(async () => {
  try {
    const { startTwitterStreamWorker } = await import(
      "./services/twitter-stream-worker"
    );
    startTwitterStreamWorker(db);
  } catch (err) {
    log.error({ err }, "Failed to start Twitter stream worker");
  }
})();

// Graceful shutdown
process.on("SIGTERM", async () => {
  log.info("SIGTERM received, closing workers...");
  if (schedulerInterval) clearInterval(schedulerInterval);
  if (summarySchedulerInterval) clearInterval(summarySchedulerInterval);
  await Promise.all([worker.close(), workflowWorker.close(), telegramOutgoingWorker.close(), telegramAutoReplyWorker.close(), broadcastProcessingWorker.close(), broadcastSendWorker.close(), scheduledMessageWorker.close(), importWorker.close(), emailWorker.close(), sequenceWorker.close(), webhookDeliveryWorker.close(), scheduledPostWorker.close()]);
  process.exit(0);
});

process.on("SIGINT", async () => {
  log.info("SIGINT received, closing workers...");
  if (schedulerInterval) clearInterval(schedulerInterval);
  if (summarySchedulerInterval) clearInterval(summarySchedulerInterval);
  await Promise.all([worker.close(), workflowWorker.close(), telegramOutgoingWorker.close(), telegramAutoReplyWorker.close(), broadcastProcessingWorker.close(), broadcastSendWorker.close(), scheduledMessageWorker.close(), importWorker.close(), emailWorker.close(), sequenceWorker.close(), webhookDeliveryWorker.close(), scheduledPostWorker.close()]);
  process.exit(0);
});
