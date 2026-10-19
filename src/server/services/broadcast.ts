import { and, eq, inArray, isNull } from "drizzle-orm";
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

  // 1. Claim atómico: solo un job procesa el broadcast, y nunca si se canceló
  // (status distinto de scheduled/processing) o ya empezó (startedAt).
  const [broadcast] = await db
    .update(broadcasts)
    .set({ status: "processing", startedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(broadcasts.id, broadcastId),
        inArray(broadcasts.status, ["scheduled", "processing"]),
        isNull(broadcasts.startedAt)
      )
    )
    .returning();

  if (!broadcast) {
    log.info({ broadcastId }, "Broadcast already processed, cancelled or missing — skipping");
    return;
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
    // Defensa en profundidad: solo contactos del tenant del broadcast.
    .where(and(eq(contacts.creatorId, broadcast.creatorId), inArray(contacts.id, contactIds)));

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

  // 5. Batch insert recipients in chunks of 500 (idempotente ante reintentos)
  const CHUNK_SIZE = 500;
  for (let i = 0; i < recipientRows.length; i += CHUNK_SIZE) {
    const chunk = recipientRows.slice(i, i + CHUNK_SIZE);
    await db.insert(broadcastRecipients).values(chunk).onConflictDoNothing();
  }

  log.info(
    { broadcastId, total: recipientRows.length, manual: manualCount },
    "Recipients created",
  );

  // 6. Update broadcast metadata (sin pisar una cancelación concurrente)
  const [sending] = await db
    .update(broadcasts)
    .set({
      totalRecipients: recipientRows.length,
      manualCount,
      status: "sending",
      filters: filters as unknown as Record<string, unknown>[],
      updatedAt: new Date(),
    })
    .where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.status, "processing")))
    .returning({ id: broadcasts.id });
  if (!sending) {
    log.info({ broadcastId }, "Broadcast cancelled during processing — not enqueuing sends");
    return;
  }

  // 7. Enqueue send jobs for pending (auto-sendable) recipients.
  // jobId por destinatario: un reintento del procesado no duplica envíos.
  const pendingToSend = await db
    .select({ id: broadcastRecipients.id })
    .from(broadcastRecipients)
    .where(
      and(
        eq(broadcastRecipients.broadcastId, broadcastId),
        eq(broadcastRecipients.status, "pending")
      )
    );

  if (pendingToSend.length > 0) {
    await broadcastSendQueue.addBulk(
      pendingToSend.map((r) => ({
        name: "send",
        data: { recipientId: r.id, broadcastId, creatorId: broadcast.creatorId },
        opts: { jobId: `broadcast-send-${r.id}` },
      }))
    );
    log.info({ broadcastId, jobCount: pendingToSend.length }, "Send jobs enqueued");
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
