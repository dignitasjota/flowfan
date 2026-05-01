import { eq, and, lte, sql } from "drizzle-orm";
import {
  sequences,
  sequenceEnrollments,
  contacts,
  conversations,
  messages,
  notifications,
} from "@/server/db/schema";
import { sequenceQueue } from "@/server/queues";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("sequence-engine");

type DB = Parameters<Parameters<typeof import("@/server/db").db.transaction>[0]>[0] | typeof import("@/server/db").db;

export interface SequenceStep {
  stepNumber: number;
  delayDays: number;
  actionType: "send_message" | "create_notification";
  actionConfig: Record<string, unknown>;
  conditions?: Record<string, unknown>;
}

// ============================================================
// Enrollment
// ============================================================

export async function enrollContact(
  db: DB,
  sequenceId: string,
  contactId: string,
  creatorId: string,
): Promise<{ enrolled: boolean; enrollmentId?: string; reason?: string }> {
  // Check if already enrolled in this sequence (active or paused)
  const existing = await (db as any)
    .select({ id: sequenceEnrollments.id })
    .from(sequenceEnrollments)
    .where(
      and(
        eq(sequenceEnrollments.sequenceId, sequenceId),
        eq(sequenceEnrollments.contactId, contactId),
        sql`${sequenceEnrollments.status} IN ('active', 'paused')`
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return { enrolled: false, reason: "already_enrolled" };
  }

  // Load sequence to get first step delay
  const [sequence] = await (db as any)
    .select()
    .from(sequences)
    .where(eq(sequences.id, sequenceId))
    .limit(1);

  if (!sequence || !sequence.isActive) {
    return { enrolled: false, reason: "sequence_inactive" };
  }

  const steps = (sequence.steps ?? []) as SequenceStep[];
  if (steps.length === 0) {
    return { enrolled: false, reason: "no_steps" };
  }

  const firstStep = steps[0]!;
  const nextStepAt = new Date(Date.now() + firstStep.delayDays * 24 * 60 * 60 * 1000);

  const [enrollment] = await (db as any)
    .insert(sequenceEnrollments)
    .values({
      sequenceId,
      contactId,
      creatorId,
      currentStep: 0,
      status: "active",
      nextStepAt,
      metadata: {},
    })
    .returning({ id: sequenceEnrollments.id });

  // Increment totalEnrolled
  await (db as any)
    .update(sequences)
    .set({
      totalEnrolled: sql`${sequences.totalEnrolled} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(sequences.id, sequenceId));

  log.info({ sequenceId, contactId, enrollmentId: enrollment.id }, "Contact enrolled in sequence");

  return { enrolled: true, enrollmentId: enrollment.id };
}

// ============================================================
// Process step
// ============================================================

export async function processSequenceStep(db: DB, enrollmentId: string): Promise<void> {
  const [enrollment] = await (db as any)
    .select()
    .from(sequenceEnrollments)
    .where(eq(sequenceEnrollments.id, enrollmentId))
    .limit(1);

  if (!enrollment || enrollment.status !== "active") {
    log.info({ enrollmentId }, "Enrollment not active, skipping");
    return;
  }

  const [sequence] = await (db as any)
    .select()
    .from(sequences)
    .where(eq(sequences.id, enrollment.sequenceId))
    .limit(1);

  if (!sequence || !sequence.isActive) {
    log.info({ enrollmentId }, "Sequence not active, skipping");
    return;
  }

  const steps = (sequence.steps ?? []) as SequenceStep[];
  const currentStepIndex = enrollment.currentStep as number;

  if (currentStepIndex >= steps.length) {
    // All steps done — mark completed
    await markCompleted(db, enrollment, sequence.id);
    return;
  }

  const step = steps[currentStepIndex]!;

  // Execute the step action
  try {
    await executeStepAction(db, step, enrollment);

    const nextStepIndex = currentStepIndex + 1;
    const stepMetadata = (enrollment.metadata as Record<string, unknown>) ?? {};
    const stepResults = { ...stepMetadata, [`step_${currentStepIndex}`]: { executedAt: new Date().toISOString(), actionType: step.actionType } };

    if (nextStepIndex >= steps.length) {
      // Last step — mark completed
      await (db as any)
        .update(sequenceEnrollments)
        .set({
          currentStep: nextStepIndex,
          lastStepAt: new Date(),
          nextStepAt: null,
          status: "completed",
          metadata: stepResults,
          updatedAt: new Date(),
        })
        .where(eq(sequenceEnrollments.id, enrollmentId));

      await (db as any)
        .update(sequences)
        .set({
          totalCompleted: sql`${sequences.totalCompleted} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(sequences.id, sequence.id));

      log.info({ enrollmentId, sequenceId: sequence.id }, "Sequence completed");
    } else {
      // More steps — calculate next
      const nextStep = steps[nextStepIndex]!;
      const nextStepAt = new Date(Date.now() + nextStep.delayDays * 24 * 60 * 60 * 1000);

      await (db as any)
        .update(sequenceEnrollments)
        .set({
          currentStep: nextStepIndex,
          lastStepAt: new Date(),
          nextStepAt,
          metadata: stepResults,
          updatedAt: new Date(),
        })
        .where(eq(sequenceEnrollments.id, enrollmentId));
    }
  } catch (err) {
    log.error({ err, enrollmentId, stepNumber: currentStepIndex }, "Step execution failed");
  }
}

// ============================================================
// Cancel enrollment
// ============================================================

export async function cancelEnrollment(db: DB, enrollmentId: string): Promise<void> {
  await (db as any)
    .update(sequenceEnrollments)
    .set({
      status: "cancelled",
      nextStepAt: null,
      updatedAt: new Date(),
    })
    .where(eq(sequenceEnrollments.id, enrollmentId));

  log.info({ enrollmentId }, "Enrollment cancelled");
}

// ============================================================
// Scheduler: check due steps
// ============================================================

export async function checkSequenceSteps(db: DB): Promise<void> {
  const now = new Date();

  const dueEnrollments = await (db as any)
    .select({ id: sequenceEnrollments.id })
    .from(sequenceEnrollments)
    .where(
      and(
        eq(sequenceEnrollments.status, "active"),
        lte(sequenceEnrollments.nextStepAt, now)
      )
    );

  for (const enrollment of dueEnrollments) {
    try {
      await sequenceQueue.add(`step-${enrollment.id}`, {
        type: "process_step",
        enrollmentId: enrollment.id,
      });
    } catch {
      // Duplicate job, skip
    }
  }

  if (dueEnrollments.length > 0) {
    log.info({ count: dueEnrollments.length }, "Sequence steps enqueued");
  }
}

// ============================================================
// Stats
// ============================================================

export async function getSequenceStats(db: DB, sequenceId: string) {
  const [sequence] = await (db as any)
    .select()
    .from(sequences)
    .where(eq(sequences.id, sequenceId))
    .limit(1);

  if (!sequence) return null;

  const enrollmentCounts = await (db as any)
    .select({
      status: sequenceEnrollments.status,
      count: sql<number>`count(*)::int`,
    })
    .from(sequenceEnrollments)
    .where(eq(sequenceEnrollments.sequenceId, sequenceId))
    .groupBy(sequenceEnrollments.status);

  const counts: Record<string, number> = {};
  for (const row of enrollmentCounts) {
    counts[row.status] = row.count;
  }

  return {
    totalEnrolled: sequence.totalEnrolled,
    totalCompleted: sequence.totalCompleted,
    totalConverted: sequence.totalConverted,
    activeCount: counts.active ?? 0,
    completedCount: counts.completed ?? 0,
    cancelledCount: counts.cancelled ?? 0,
    pausedCount: counts.paused ?? 0,
    conversionRate: sequence.totalEnrolled > 0
      ? Math.round((sequence.totalConverted / sequence.totalEnrolled) * 100)
      : 0,
  };
}

// ============================================================
// Helpers
// ============================================================

async function markCompleted(db: DB, enrollment: any, sequenceId: string): Promise<void> {
  await (db as any)
    .update(sequenceEnrollments)
    .set({
      status: "completed",
      nextStepAt: null,
      updatedAt: new Date(),
    })
    .where(eq(sequenceEnrollments.id, enrollment.id));

  await (db as any)
    .update(sequences)
    .set({
      totalCompleted: sql`${sequences.totalCompleted} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(sequences.id, sequenceId));
}

async function executeStepAction(
  db: DB,
  step: SequenceStep,
  enrollment: any,
): Promise<void> {
  const contactId = enrollment.contactId as string;
  const creatorId = enrollment.creatorId as string;

  switch (step.actionType) {
    case "send_message": {
      const content = step.actionConfig.content as string;
      if (!content) return;

      // Find the latest active conversation for this contact
      const [conversation] = await (db as any)
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.contactId, contactId),
            eq(conversations.creatorId, creatorId),
            eq(conversations.status, "active")
          )
        )
        .limit(1);

      if (!conversation) {
        log.warn({ contactId }, "No active conversation for sequence message");
        return;
      }

      // Interpolate contact variables
      const [contact] = await (db as any)
        .select({ username: contacts.username, displayName: contacts.displayName })
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .limit(1);

      const finalContent = content
        .replace(/\{\{username\}\}/g, contact?.username ?? "")
        .replace(/\{\{displayName\}\}/g, contact?.displayName ?? "");

      await (db as any).insert(messages).values({
        conversationId: conversation.id,
        role: "creator",
        content: finalContent,
      });

      await (db as any)
        .update(conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversations.id, conversation.id));

      log.info({ contactId, conversationId: conversation.id }, "Sequence message sent");
      break;
    }

    case "create_notification": {
      const title = (step.actionConfig.title as string) ?? "Recordatorio de secuencia";
      const message = (step.actionConfig.message as string) ?? "";

      await (db as any).insert(notifications).values({
        creatorId,
        contactId,
        type: "sequence",
        title,
        message,
        data: { sequenceId: enrollment.sequenceId, step: enrollment.currentStep },
      });
      break;
    }

    default:
      log.warn({ actionType: step.actionType }, "Unknown sequence step action");
  }
}
