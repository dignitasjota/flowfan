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
