import { eq, and, sql, desc } from "drizzle-orm";
import { workflows, conversations, messages } from "@/server/db/schema";
import { workflowQueue } from "@/server/queues";
import { createChildLogger } from "@/lib/logger";
import { setOnce } from "@/lib/rate-limit";

const log = createChildLogger("workflow-scheduler");

/** Margen tras el umbral máximo durante el que aún se evalúa una conversación. */
const LOOKBACK_MINUTES = 7 * 24 * 60;
const MAX_CONVERSATIONS_PER_CREATOR = 2000;

type Db = Parameters<Parameters<typeof import("@/server/db").db.transaction>[0]>[0] | typeof import("@/server/db").db;

/**
 * Checks all active no_response_timeout workflows and enqueues events
 * for conversations where the creator hasn't responded in time.
 */
export async function checkNoResponseTimeouts(db: Db): Promise<void> {
  // Find all active workflows with no_response_timeout trigger
  const activeWorkflows = await (db as any)
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.isActive, true),
        eq(workflows.triggerType, "no_response_timeout")
      )
    );

  if (activeWorkflows.length === 0) return;

  // Group by creatorId for efficient querying
  const byCreator = new Map<string, typeof activeWorkflows>();
  for (const wf of activeWorkflows) {
    const list = byCreator.get(wf.creatorId) ?? [];
    list.push(wf);
    byCreator.set(wf.creatorId, list);
  }

  for (const [creatorId, creatorWorkflows] of byCreator) {
    const thresholds = [
      ...new Set(
        creatorWorkflows.map((wf: any) => {
          const config = wf.triggerConfig as { minutes?: number };
          return Math.max(1, config.minutes ?? 60);
        })
      ),
    ] as number[];
    const minMinutes = Math.min(...thresholds);
    const maxMinutes = Math.max(...thresholds);

    // Ventana acotada: conversaciones cuyo último mensaje está entre el umbral
    // mínimo y (umbral máximo + 7 días). Antes se recorrían TODAS las
    // conversaciones antiguas en cada tick, para siempre.
    const now = Date.now();
    const newest = new Date(now - minMinutes * 60 * 1000);
    const oldest = new Date(now - (maxMinutes + LOOKBACK_MINUTES) * 60 * 1000);

    const staleConversations = await (db as any)
      .select({
        id: conversations.id,
        contactId: conversations.contactId,
        lastMessageAt: conversations.lastMessageAt,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.creatorId, creatorId),
          eq(conversations.status, "active"),
          sql`${conversations.lastMessageAt} < ${newest}`,
          sql`${conversations.lastMessageAt} >= ${oldest}`
        )
      )
      .limit(MAX_CONVERSATIONS_PER_CREATOR);

    for (const conv of staleConversations) {
      // Check if the last message was from the fan (not creator)
      const [lastMsg] = await (db as any)
        .select({ role: messages.role })
        .from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(desc(messages.createdAt))
        .limit(1);

      if (!lastMsg || lastMsg.role !== "fan") continue;

      const lastMessageAt = new Date(conv.lastMessageAt);
      const minutesSince = Math.round((now - lastMessageAt.getTime()) / (1000 * 60));

      for (const threshold of thresholds) {
        if (minutesSince < threshold) continue;
        // Un evento por (conversación, mensaje del fan, umbral). Si el fan
        // vuelve a escribir, lastMessageAt cambia y se puede volver a disparar.
        const first = await setOnce(
          `nrt:${conv.id}:${lastMessageAt.getTime()}:${threshold}`,
          (threshold + LOOKBACK_MINUTES) * 60
        );
        if (!first) continue;

        await workflowQueue
          .add("no_response_timeout", {
            type: "no_response_timeout" as const,
            creatorId,
            contactId: conv.contactId,
            conversationId: conv.id,
            minutesSinceLastResponse: minutesSince,
            thresholdMinutes: threshold,
          })
          .catch((err) => log.warn({ err }, "Failed to enqueue no_response_timeout"));
      }
    }
  }

  log.debug(
    { creatorCount: byCreator.size, workflowCount: activeWorkflows.length },
    "No-response timeout check completed"
  );
}

/**
 * Checks active followup sequences and auto-enrolls contacts
 * that meet inactivity criteria and are not already enrolled.
 */
export async function checkInactivityFollowups(db: Db): Promise<void> {
  const { sequences, sequenceEnrollments, contacts: contactsTable, contactProfiles } = await import("@/server/db/schema");
  const { enrollContact } = await import("@/server/services/sequence-engine");

  // Find active followup sequences
  const followupSequences = await (db as any)
    .select()
    .from(sequences)
    .where(
      and(
        eq(sequences.isActive, true),
        eq(sequences.type, "followup")
      )
    );

  if (followupSequences.length === 0) return;

  for (const sequence of followupSequences) {
    const criteria = sequence.enrollmentCriteria as {
      minDaysInactive?: number;
      funnelStages?: string[];
    };

    const minDays = criteria.minDaysInactive ?? 3;
    const funnelStages = criteria.funnelStages ?? [];
    const cutoff = new Date(Date.now() - minDays * 24 * 60 * 60 * 1000);

    // Find inactive contacts for this creator
    const inactiveContacts = await (db as any)
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .innerJoin(contactProfiles, eq(contactProfiles.contactId, contactsTable.id))
      .where(
        and(
          eq(contactsTable.creatorId, sequence.creatorId),
          eq(contactsTable.isArchived, false),
          sql`${contactsTable.lastInteractionAt} < ${cutoff}`,
          funnelStages.length > 0
            ? sql`${contactProfiles.funnelStage} IN (${sql.join(funnelStages.map((s: string) => sql`${s}`), sql`, `)})`
            : sql`1=1`,
          // No reinscribir a quien ya pasó por la secuencia desde su última
          // interacción (completada o cancelada): antes el índice único solo
          // cubría active/paused y el contacto recibía la cadena en bucle cada
          // 30 min. Si el fan vuelve a escribir y luego se enfría, sí vuelve a entrar.
          sql`NOT EXISTS (
            SELECT 1 FROM ${sequenceEnrollments}
            WHERE ${sequenceEnrollments.sequenceId} = ${sequence.id}
              AND ${sequenceEnrollments.contactId} = ${contactsTable.id}
              AND ${sequenceEnrollments.enrolledAt} >= ${contactsTable.lastInteractionAt}
          )`
        )
      )
      .limit(500);

    for (const contact of inactiveContacts) {
      try {
        await enrollContact(db as any, sequence.id, contact.id, sequence.creatorId);
      } catch {
        // Skip errors (duplicate enrollment, etc.)
      }
    }
  }

  log.debug({ sequenceCount: followupSequences.length }, "Inactivity followup check completed");
}
