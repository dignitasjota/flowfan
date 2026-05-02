import type { db as dbType } from "@/server/db";
import { teamAuditLog } from "@/server/db/schema";

type Db = typeof dbType;

export async function logTeamAction(
  db: Db,
  params: {
    creatorId: string;
    userId: string;
    userName: string;
    action: string;
    entityType: string;
    entityId?: string;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await db.insert(teamAuditLog).values({
      creatorId: params.creatorId,
      userId: params.userId,
      userName: params.userName,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      details: params.details ?? {},
    });
  } catch {
    // Audit logging should never break the main flow
  }
}
