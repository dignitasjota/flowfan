import { Queue } from "bullmq";

export const analysisQueue = new Queue("message-analysis", {
  connection: {
    host: new URL(process.env.REDIS_URL ?? "redis://localhost:6379").hostname,
    port: Number(new URL(process.env.REDIS_URL ?? "redis://localhost:6379").port) || 6379,
  },
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
};

// --- Workflow evaluation queue ---

export const workflowQueue = new Queue("workflow-evaluation", {
  connection: {
    host: new URL(process.env.REDIS_URL ?? "redis://localhost:6379").hostname,
    port: Number(new URL(process.env.REDIS_URL ?? "redis://localhost:6379").port) || 6379,
  },
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
