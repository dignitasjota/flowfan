import { eq, and } from "drizzle-orm";
import { aiConfigs, aiModelAssignments } from "@/server/db/schema";
import type { AIConfig } from "./ai";
import { decrypt } from "@/lib/crypto";
import type { db as dbInstance } from "@/server/db";

type TaskType = "suggestion" | "analysis" | "summary" | "report" | "price_advice" | "coaching" | "content_gap";

type Database = typeof dbInstance;

/**
 * Resolves the AI config for a specific task.
 * Priority: task-specific assignment > default config
 */
export async function resolveAIConfig(
  db: Database,
  creatorId: string,
  taskType: TaskType
): Promise<AIConfig | null> {
  // 1. Check for task-specific assignment
  const assignment = await db.query.aiModelAssignments.findFirst({
    where: and(
      eq(aiModelAssignments.creatorId, creatorId),
      eq(aiModelAssignments.taskType, taskType)
    ),
  });

  if (assignment) {
    // If assignment has its own API key, decrypt and use it; otherwise fall back to default config's key
    if (assignment.apiKey) {
      return {
        provider: assignment.provider,
        model: assignment.model,
        apiKey: decrypt(assignment.apiKey),
      };
    }

    // Get default config for API key
    const defaultConfig = await db.query.aiConfigs.findFirst({
      where: eq(aiConfigs.creatorId, creatorId),
    });

    if (defaultConfig) {
      return {
        provider: assignment.provider,
        model: assignment.model,
        apiKey: decrypt(defaultConfig.apiKey),
      };
    }
  }

  // 2. Fall back to default config
  const defaultConfig = await db.query.aiConfigs.findFirst({
    where: eq(aiConfigs.creatorId, creatorId),
  });

  if (!defaultConfig) return null;

  return {
    provider: defaultConfig.provider,
    model: defaultConfig.model,
    apiKey: decrypt(defaultConfig.apiKey),
  };
}
