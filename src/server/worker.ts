import "dotenv/config";
import { Worker } from "bullmq";
import { db } from "./db";
import { analyzeMessage } from "./services/ai-analysis";
import { updateContactProfile } from "./services/profile-updater";
import { resolveAIConfig } from "./services/ai-config-resolver";
import type { AnalysisJobData } from "./queues";
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
    await updateContactProfile(db, contactId, messageId, analysis);

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

// Graceful shutdown
process.on("SIGTERM", async () => {
  log.info("SIGTERM received, closing worker...");
  await worker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  log.info("SIGINT received, closing worker...");
  await worker.close();
  process.exit(0);
});
