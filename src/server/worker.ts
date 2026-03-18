import { Worker } from "bullmq";
import { db } from "./db";
import { analyzeMessage } from "./services/ai-analysis";
import { updateContactProfile } from "./services/profile-updater";
import { resolveAIConfig } from "./services/ai-config-resolver";
import { evaluateWorkflows } from "./services/workflow-engine";
import { checkNoResponseTimeouts } from "./services/workflow-scheduler";
import type { AnalysisJobData, WorkflowJobData } from "./queues";
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

// --- Periodic no_response_timeout checker (every 5 minutes) ---

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
  }, 5 * 60 * 1000);
}

startScheduler();

// Graceful shutdown
process.on("SIGTERM", async () => {
  log.info("SIGTERM received, closing workers...");
  if (schedulerInterval) clearInterval(schedulerInterval);
  await Promise.all([worker.close(), workflowWorker.close()]);
  process.exit(0);
});

process.on("SIGINT", async () => {
  log.info("SIGINT received, closing workers...");
  if (schedulerInterval) clearInterval(schedulerInterval);
  await Promise.all([worker.close(), workflowWorker.close()]);
  process.exit(0);
});
