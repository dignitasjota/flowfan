import { Queue } from "bullmq";
import { getRedisConnectionOptions } from "@/lib/redis-connection";

export const analysisQueue = new Queue("message-analysis", {
  connection: getRedisConnectionOptions(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export type AnalysisJobData = {
  creatorId: string;
  contactId: string;
  messageId: string;
  conversationId: string;
  messageContent: string;
  platformType: string;
  conversationHistory: { role: string; content: string }[];
  // Optional: distinguishes scoring source. Default "message" (DM/conversation).
  // For "comment", messageId refers to socialComments.id and conversationId may be empty.
  source?: "message" | "comment";
};

// --- Workflow evaluation queue ---

export const workflowQueue = new Queue("workflow-evaluation", {
  connection: getRedisConnectionOptions(),
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: { count: 2000 },
    removeOnFail: { count: 5000 },
  },
});

export type WorkflowJobData =
  | { type: "no_response_timeout"; creatorId: string; contactId: string; conversationId: string; minutesSinceLastResponse: number }
  | { type: "funnel_stage_change"; creatorId: string; contactId: string; previousStage: string; newStage: string }
  | { type: "sentiment_change"; creatorId: string; contactId: string; conversationId: string; direction: "positive" | "negative"; delta: number }
  | { type: "keyword_detected"; creatorId: string; contactId: string; conversationId: string; messageContent: string; matchedKeywords: string[] }
  | { type: "new_contact"; creatorId: string; contactId: string; platformType: string };

// --- Telegram queues ---

export const telegramOutgoingQueue = new Queue("telegram-outgoing", {
  connection: getRedisConnectionOptions(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 2000 },
    removeOnFail: { count: 5000 },
  },
});

export type TelegramOutgoingJobData = {
  creatorId: string;
  chatId: string;
  text: string;
  conversationId: string;
  messageId: string;
};

export const telegramAutoReplyQueue = new Queue("telegram-auto-reply", {
  connection: getRedisConnectionOptions(),
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: { count: 2000 },
    removeOnFail: { count: 5000 },
  },
});

export type TelegramAutoReplyJobData = {
  creatorId: string;
  contactId: string;
  conversationId: string;
  chatId: string;
  messageContent: string;
};

// --- Broadcast queues ---

export const broadcastProcessingQueue = new Queue("broadcast-processing", {
  connection: getRedisConnectionOptions(),
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 2000 },
  },
});

export type BroadcastProcessingJobData = {
  broadcastId: string;
  creatorId: string;
};

export const broadcastSendQueue = new Queue("broadcast-send", {
  connection: getRedisConnectionOptions(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 5000 },
    removeOnFail: { count: 10000 },
  },
});

export type BroadcastSendJobData = {
  recipientId: string;
  broadcastId: string;
  creatorId: string;
};

// --- Scheduled messages queue ---

export const scheduledMessageQueue = new Queue("scheduled-message-send", {
  connection: getRedisConnectionOptions(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 2000 },
    removeOnFail: { count: 5000 },
  },
});

export type ScheduledMessageJobData = {
  scheduledMessageId: string;
  creatorId: string;
};

// --- Contact import queue ---

export const importQueue = new Queue("contact-import", {
  connection: getRedisConnectionOptions(),
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

export type ImportJobData = {
  importJobId: string;
  creatorId: string;
};

// --- Email queue ---

export const emailQueue = new Queue("email-send", {
  connection: getRedisConnectionOptions(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 5000 },
    removeOnFail: { count: 10000 },
  },
});

export type EmailJobData = {
  type: "verification" | "password_reset" | "daily_summary" | "weekly_summary" | "churn_alert";
  to: string;
  data: Record<string, unknown>;
};

// --- Sequence queue ---

export const sequenceQueue = new Queue("sequence-processing", {
  connection: getRedisConnectionOptions(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 2000 },
    removeOnFail: { count: 5000 },
  },
});

export type SequenceJobData =
  | { type: "process_step"; enrollmentId: string }
  | { type: "enroll"; sequenceId: string; contactId: string; creatorId: string };

// --- Webhook delivery queue ---

export const webhookDeliveryQueue = new Queue("webhook-delivery", {
  connection: getRedisConnectionOptions(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 5000 },
    removeOnFail: { count: 10000 },
  },
});

export type WebhookDeliveryJobData = {
  webhookConfigId: string;
  event: string;
  payload: Record<string, unknown>;
  url: string;
  secret: string;
};

// --- Scheduled post publishing queue ---

export const scheduledPostQueue = new Queue("scheduled-post-publish", {
  connection: getRedisConnectionOptions(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export type ScheduledPostJobData = {
  scheduledPostId: string;
  creatorId: string;
};
