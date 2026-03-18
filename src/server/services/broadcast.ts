import { eq, inArray } from "drizzle-orm";
import {
  broadcasts,
  broadcastRecipients,
  contacts,
  segments,
} from "@/server/db/schema";
import { broadcastSendQueue } from "@/server/queues";
import { evaluateSegment } from "@/server/services/segment-evaluator";
import { createChildLogger } from "@/lib/logger";

type Db = typeof import("@/server/db").db;

const log = createChildLogger("broadcast-service");

// ---------------------------------------------------------------------------
// Variable resolution
// ---------------------------------------------------------------------------

export function resolveVariables(
  content: string,
  contact: {
    username: string;
    displayName: string | null;
    platformType: string;
  },
): string {
  const displayName = contact.displayName ?? contact.username;

  return content
    .replace(/\{\{displayName\}\}/g, displayName)
    .replace(/\{\{username\}\}/g, contact.username)
    .replace(/\{\{platformType\}\}/g, contact.platformType);
}

// ---------------------------------------------------------------------------
// Main broadcast processing
// ---------------------------------------------------------------------------

export async function processSegment(
  db: Db,
  broadcastId: string,
): Promise<void> {
  log.info({ broadcastId }, "Processing broadcast segment");

  // 1. Get the broadcast with its segment
  const [broadcast] = await db
    .select()
    .from(broadcasts)
    .where(eq(broadcasts.id, broadcastId))
    .limit(1);

  if (!broadcast) {
    throw new Error(`Broadcast not found: ${broadcastId}`);
  }

  // Load segment if linked
  let segmentFilters: unknown[] = [];
  let segmentType: "dynamic" | "static" | "mixed" | undefined;

  if (broadcast.segmentId) {
    const [segment] = await db
      .select()
      .from(segments)
      .where(eq(segments.id, broadcast.segmentId))
      .limit(1);

    if (segment) {
      segmentFilters = segment.filters as unknown[];
      segmentType = segment.type;
    }
  }

  // Use broadcast-level filters as override if present
  const filters = (
    Array.isArray(broadcast.filters) && broadcast.filters.length > 0
      ? broadcast.filters
      : segmentFilters
  ) as Parameters<typeof evaluateSegment>[2]["filters"];

  // 2. Evaluate the segment to get contact IDs
  const { contactIds } = await evaluateSegment(db, broadcast.creatorId, {
    filters,
    segmentId: broadcast.segmentId ?? undefined,
    segmentType,
  });

  if (contactIds.length === 0) {
    log.warn({ broadcastId }, "No contacts matched the segment");
    await db
      .update(broadcasts)
      .set({
        status: "completed",
        totalRecipients: 0,
        startedAt: new Date(),
        completedAt: new Date(),
        filters: filters as unknown as Record<string, unknown>[],
        updatedAt: new Date(),
      })
      .where(eq(broadcasts.id, broadcastId));
    return;
  }

  // 3. Fetch full contact data for matched IDs
  const contactRows = await db
    .select({
      id: contacts.id,
      username: contacts.username,
      displayName: contacts.displayName,
      platformType: contacts.platformType,
      platformUserId: contacts.platformUserId,
    })
    .from(contacts)
    .where(inArray(contacts.id, contactIds));

  // 4. Build recipient rows
  let manualCount = 0;
  const recipientRows = contactRows.map((contact) => {
    const resolvedContent = resolveVariables(broadcast.content, {
      username: contact.username,
      displayName: contact.displayName,
      platformType: contact.platformType,
    });

    const canAutoSend =
      contact.platformType === "telegram" && !!contact.platformUserId;
    const status = canAutoSend ? ("pending" as const) : ("manual" as const);

    if (status === "manual") {
      manualCount++;
    }

    return {
      broadcastId,
      contactId: contact.id,
      platformUserId: contact.platformUserId,
      resolvedContent,
      status,
    };
  });

  // 5. Batch insert recipients in chunks of 500
  const CHUNK_SIZE = 500;
  for (let i = 0; i < recipientRows.length; i += CHUNK_SIZE) {
    const chunk = recipientRows.slice(i, i + CHUNK_SIZE);
    await db.insert(broadcastRecipients).values(chunk);
  }

  log.info(
    { broadcastId, total: recipientRows.length, manual: manualCount },
    "Recipients created",
  );

  // 6. Update broadcast metadata
  await db
    .update(broadcasts)
    .set({
      totalRecipients: recipientRows.length,
      manualCount,
      status: "sending",
      startedAt: new Date(),
      filters: filters as unknown as Record<string, unknown>[],
      updatedAt: new Date(),
    })
    .where(eq(broadcasts.id, broadcastId));

  // 7. Enqueue send jobs for pending (auto-sendable) recipients
  const pendingRecipients = recipientRows.filter((r) => r.status === "pending");

  for (const recipient of pendingRecipients) {
    // We need the inserted recipient ID — query them back
    // Instead, query all pending recipients for this broadcast
  }

  // Fetch inserted pending recipients to get their IDs
  if (pendingRecipients.length > 0) {
    const insertedPending = await db
      .select({ id: broadcastRecipients.id })
      .from(broadcastRecipients)
      .where(
        eq(broadcastRecipients.broadcastId, broadcastId),
      );

    const pendingInserted = insertedPending.filter((r) => {
      // We need status too
      return true;
    });

    // Re-query with status
    const pendingToSend = await db
      .select({
        id: broadcastRecipients.id,
        status: broadcastRecipients.status,
      })
      .from(broadcastRecipients)
      .where(eq(broadcastRecipients.broadcastId, broadcastId));

    const jobs = pendingToSend
      .filter((r) => r.status === "pending")
      .map((r) => ({
        name: `send-${r.id}`,
        data: {
          recipientId: r.id,
          broadcastId,
          creatorId: broadcast.creatorId,
        },
      }));

    if (jobs.length > 0) {
      await broadcastSendQueue.addBulk(jobs);
      log.info(
        { broadcastId, jobCount: jobs.length },
        "Send jobs enqueued",
      );
    }
  }

  // 8. If all recipients are manual, mark broadcast as completed immediately
  if (manualCount === recipientRows.length) {
    await db
      .update(broadcasts)
      .set({
        status: "completed",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(broadcasts.id, broadcastId));

    log.info({ broadcastId }, "All recipients are manual — broadcast completed");
  }
}
