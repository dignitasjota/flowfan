import { eq, and, desc, gte, sql } from "drizzle-orm";
import {
  workflows,
  workflowExecutions,
  contacts,
  contactProfiles,
  conversations,
  messages,
  notifications,
  responseTemplates,
} from "@/server/db/schema";
import { createChildLogger } from "@/lib/logger";

const logger = createChildLogger("workflow-engine");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Db = typeof import("@/server/db").db;

export type WorkflowEvent =
  | {
      type: "no_response_timeout";
      creatorId: string;
      contactId: string;
      conversationId: string;
      minutesSinceLastResponse: number;
    }
  | {
      type: "funnel_stage_change";
      creatorId: string;
      contactId: string;
      previousStage: string;
      newStage: string;
    }
  | {
      type: "sentiment_change";
      creatorId: string;
      contactId: string;
      conversationId: string;
      direction: "positive" | "negative";
      delta: number;
    }
  | {
      type: "keyword_detected";
      creatorId: string;
      contactId: string;
      conversationId: string;
      messageContent: string;
      matchedKeywords: string[];
    }
  | {
      type: "new_contact";
      creatorId: string;
      contactId: string;
      platformType: string;
    };

interface WorkflowCondition {
  field: string;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains";
  value: unknown;
}

interface ContactData {
  funnelStage: string;
  platformType: string;
  engagementLevel: number;
  paymentProbability: number;
  tags: string[];
}

interface ActionResult {
  success: boolean;
  result: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function evaluateWorkflows(
  db: Db,
  event: WorkflowEvent,
): Promise<void> {
  logger.info({ eventType: event.type, creatorId: event.creatorId }, "Evaluating workflows");

  // Fetch all active workflows that match the trigger type for this creator
  const activeWorkflows = await db
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.creatorId, event.creatorId),
        eq(workflows.isActive, true),
        eq(workflows.triggerType, event.type),
      ),
    );

  logger.info({ count: activeWorkflows.length }, "Found matching workflows");

  for (const workflow of activeWorkflows) {
    try {
      // (a) Check trigger config
      if (!matchesTrigger(event, workflow.triggerConfig as Record<string, unknown>)) {
        await recordExecution(db, workflow, event, null, "skipped", "Trigger config did not match");
        continue;
      }

      // (b) Load contact + profile data
      const contactData = await loadContactData(db, event.contactId);
      if (!contactData) {
        await recordExecution(db, workflow, event, null, "skipped", "Contact not found");
        continue;
      }

      // (c) Evaluate conditions
      const conditions = (workflow.conditions ?? []) as WorkflowCondition[];
      if (!evaluateConditions(conditions, contactData)) {
        await recordExecution(db, workflow, event, null, "skipped", "Conditions not met");
        continue;
      }

      // (d) Check cooldown
      const inCooldown = await checkCooldown(
        db,
        workflow.id,
        event.contactId,
        workflow.cooldownMinutes,
      );
      if (inCooldown) {
        await recordExecution(db, workflow, event, null, "skipped", "In cooldown period");
        continue;
      }

      // (e) Execute the action
      const conversationId = "conversationId" in event ? event.conversationId : undefined;
      const actionResult = await executeAction(
        db,
        workflow,
        event.contactId,
        conversationId as string | undefined,
      );

      // (f) Record execution
      await recordExecution(
        db,
        workflow,
        event,
        actionResult,
        actionResult.success ? "success" : "failed",
        actionResult.error,
      );

      // (g) Increment executionCount and update lastExecutedAt
      if (actionResult.success) {
        await db
          .update(workflows)
          .set({
            executionCount: sql`${workflows.executionCount} + 1`,
            lastExecutedAt: new Date(),
          })
          .where(eq(workflows.id, workflow.id));
      }

      logger.info(
        { workflowId: workflow.id, workflowName: workflow.name, success: actionResult.success },
        "Workflow executed",
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ workflowId: workflow.id, error: errorMessage }, "Workflow execution failed");
      await recordExecution(db, workflow, event, null, "failed", errorMessage);
    }
  }
}

// ---------------------------------------------------------------------------
// Trigger matching
// ---------------------------------------------------------------------------

export function matchesTrigger(
  event: WorkflowEvent,
  triggerConfig: Record<string, unknown>,
): boolean {
  switch (event.type) {
    case "no_response_timeout":
      return event.minutesSinceLastResponse >= (triggerConfig.minutes as number ?? 0);

    case "funnel_stage_change":
      return (
        (!triggerConfig.from || triggerConfig.from === event.previousStage) &&
        (!triggerConfig.to || triggerConfig.to === event.newStage)
      );

    case "sentiment_change":
      return event.direction === triggerConfig.direction;

    case "keyword_detected": {
      const keywords = (triggerConfig.keywords as string[]) ?? [];
      return keywords.some((kw) =>
        event.matchedKeywords.includes(kw.toLowerCase()),
      );
    }

    case "new_contact":
      return !triggerConfig.platformType || triggerConfig.platformType === event.platformType;

    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Condition evaluation (pure function)
// ---------------------------------------------------------------------------

export function evaluateConditions(
  conditions: WorkflowCondition[],
  contactData: ContactData,
): boolean {
  if (!conditions || conditions.length === 0) return true;

  return conditions.every((condition) => {
    const fieldValue = (contactData as unknown as Record<string, unknown>)[condition.field];
    const condValue = condition.value;

    switch (condition.operator) {
      case "eq":
        return fieldValue === condValue;
      case "neq":
        return fieldValue !== condValue;
      case "gt":
        return (fieldValue as number) > (condValue as number);
      case "gte":
        return (fieldValue as number) >= (condValue as number);
      case "lt":
        return (fieldValue as number) < (condValue as number);
      case "lte":
        return (fieldValue as number) <= (condValue as number);
      case "in":
        return Array.isArray(condValue) && condValue.includes(fieldValue);
      case "contains":
        return Array.isArray(fieldValue) && fieldValue.includes(condValue);
      default:
        return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Cooldown check
// ---------------------------------------------------------------------------

export async function checkCooldown(
  db: Db,
  workflowId: string,
  contactId: string,
  cooldownMinutes: number,
): Promise<boolean> {
  if (cooldownMinutes <= 0) return false;

  const cutoff = new Date(Date.now() - cooldownMinutes * 60 * 1000);

  const lastExecution = await db
    .select({ executedAt: workflowExecutions.executedAt })
    .from(workflowExecutions)
    .where(
      and(
        eq(workflowExecutions.workflowId, workflowId),
        eq(workflowExecutions.contactId, contactId),
        eq(workflowExecutions.status, "success"),
        gte(workflowExecutions.executedAt, cutoff),
      ),
    )
    .orderBy(desc(workflowExecutions.executedAt))
    .limit(1);

  return lastExecution.length > 0;
}

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------

export async function executeAction(
  db: Db,
  workflow: typeof workflows.$inferSelect,
  contactId: string,
  conversationId?: string,
): Promise<ActionResult> {
  const actionConfig = workflow.actionConfig as Record<string, unknown>;

  // Load contact for variable interpolation
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (!contact) {
    return { success: false, result: null, error: "Contact not found" };
  }

  switch (workflow.actionType) {
    case "send_message":
      return executeSendMessage(db, actionConfig, contact, conversationId);

    case "send_template":
      return executeSendTemplate(db, actionConfig, contact, conversationId);

    case "create_notification":
      return executeCreateNotification(db, actionConfig, contact, workflow.creatorId);

    case "change_tags":
      return executeChangeTags(db, actionConfig, contact);

    default:
      return { success: false, result: null, error: `Unknown action type: ${workflow.actionType}` };
  }
}

// ---------------------------------------------------------------------------
// Action implementations
// ---------------------------------------------------------------------------

async function executeSendMessage(
  db: Db,
  config: Record<string, unknown>,
  contact: typeof contacts.$inferSelect,
  conversationId?: string,
): Promise<ActionResult> {
  if (!conversationId) {
    return { success: false, result: null, error: "No conversation ID provided for send_message" };
  }

  const content = interpolateVars(config.content as string, contact);

  const [inserted] = await db
    .insert(messages)
    .values({
      conversationId,
      role: "creator",
      content,
    })
    .returning({ id: messages.id });

  // Update conversation lastMessageAt
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, conversationId));

  return { success: true, result: { messageId: inserted.id, content } };
}

async function executeSendTemplate(
  db: Db,
  config: Record<string, unknown>,
  contact: typeof contacts.$inferSelect,
  conversationId?: string,
): Promise<ActionResult> {
  if (!conversationId) {
    return { success: false, result: null, error: "No conversation ID provided for send_template" };
  }

  const templateId = config.templateId as string;
  const [template] = await db
    .select()
    .from(responseTemplates)
    .where(eq(responseTemplates.id, templateId))
    .limit(1);

  if (!template) {
    return { success: false, result: null, error: `Template not found: ${templateId}` };
  }

  const content = interpolateVars(template.content, contact);

  const [inserted] = await db
    .insert(messages)
    .values({
      conversationId,
      role: "creator",
      content,
    })
    .returning({ id: messages.id });

  // Update conversation lastMessageAt
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, conversationId));

  // Increment template usage count
  await db
    .update(responseTemplates)
    .set({ usageCount: sql`${responseTemplates.usageCount} + 1` })
    .where(eq(responseTemplates.id, templateId));

  return {
    success: true,
    result: { messageId: inserted.id, templateId, content },
  };
}

async function executeCreateNotification(
  db: Db,
  config: Record<string, unknown>,
  contact: typeof contacts.$inferSelect,
  creatorId: string,
): Promise<ActionResult> {
  const title = interpolateVars(config.title as string, contact);
  const message = interpolateVars(config.message as string, contact);

  const [inserted] = await db
    .insert(notifications)
    .values({
      creatorId,
      contactId: contact.id,
      type: (config.type as string) ?? "workflow",
      title,
      message,
      data: { source: "workflow" },
    })
    .returning({ id: notifications.id });

  return { success: true, result: { notificationId: inserted.id, title, message } };
}

async function executeChangeTags(
  db: Db,
  config: Record<string, unknown>,
  contact: typeof contacts.$inferSelect,
): Promise<ActionResult> {
  const tagsToAdd = (config.add as string[]) ?? [];
  const tagsToRemove = (config.remove as string[]) ?? [];

  const currentTags = (contact.tags ?? []) as string[];

  // Remove tags first, then add new ones
  let updatedTags = currentTags.filter((t) => !tagsToRemove.includes(t));
  for (const tag of tagsToAdd) {
    if (!updatedTags.includes(tag)) {
      updatedTags.push(tag);
    }
  }

  await db
    .update(contacts)
    .set({ tags: updatedTags })
    .where(eq(contacts.id, contact.id));

  return {
    success: true,
    result: { previousTags: currentTags, updatedTags, added: tagsToAdd, removed: tagsToRemove },
  };
}

// ---------------------------------------------------------------------------
// Variable interpolation
// ---------------------------------------------------------------------------

export function interpolateVars(
  text: string,
  contact: typeof contacts.$inferSelect,
): string {
  return text
    .replace(/\{\{username\}\}/g, contact.username ?? "")
    .replace(/\{\{displayName\}\}/g, contact.displayName ?? "")
    .replace(/\{\{platformType\}\}/g, contact.platformType ?? "");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadContactData(
  db: Db,
  contactId: string,
): Promise<ContactData | null> {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (!contact) return null;

  const [profile] = await db
    .select()
    .from(contactProfiles)
    .where(eq(contactProfiles.contactId, contactId))
    .limit(1);

  return {
    funnelStage: profile?.funnelStage ?? "cold",
    platformType: contact.platformType,
    engagementLevel: profile?.engagementLevel ?? 0,
    paymentProbability: profile?.paymentProbability ?? 0,
    tags: (contact.tags ?? []) as string[],
  };
}

async function recordExecution(
  db: Db,
  workflow: typeof workflows.$inferSelect,
  event: WorkflowEvent,
  actionResult: ActionResult | null,
  status: string,
  errorMessage?: string,
): Promise<void> {
  await db.insert(workflowExecutions).values({
    workflowId: workflow.id,
    creatorId: event.creatorId,
    contactId: event.contactId,
    conversationId: "conversationId" in event ? (event.conversationId as string) : undefined,
    triggerData: event as unknown as Record<string, unknown>,
    actionResult: (actionResult ?? {}) as Record<string, unknown>,
    status,
    errorMessage: errorMessage ?? null,
  });
}
