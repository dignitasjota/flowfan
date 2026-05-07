import { createHmac } from "crypto";
import { eq, and } from "drizzle-orm";
import { webhookConfigs, webhookDeliveryLogs } from "@/server/db/schema";
import { webhookDeliveryQueue } from "@/server/queues";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("webhook-dispatcher");

type DB = Parameters<Parameters<typeof import("@/server/db").db.transaction>[0]>[0] | typeof import("@/server/db").db;

export type WebhookEvent =
  | "contact.created"
  | "contact.updated"
  | "message.received"
  | "funnel_stage.changed"
  | "transaction.created"
  | "comment.received"
  | "post.scheduled"
  | "post.publishing"
  | "post.published"
  | "post.failed";

export async function dispatchWebhookEvent(
  db: DB,
  creatorId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const configs = await (db as any).query.webhookConfigs.findMany({
      where: and(
        eq(webhookConfigs.creatorId, creatorId),
        eq(webhookConfigs.isActive, true)
      ),
    });

    const matching = configs.filter((c: any) =>
      Array.isArray(c.events) && c.events.includes(event)
    );

    for (const config of matching) {
      await webhookDeliveryQueue.add("deliver", {
        webhookConfigId: config.id,
        event,
        payload,
        url: config.url,
        secret: config.secret,
      });
    }
  } catch (error) {
    log.warn({ err: error, event, creatorId }, "Failed to dispatch webhook event");
  }
}

export function generateWebhookSignature(
  payload: string,
  secret: string
): string {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

export async function deliverWebhook(
  db: DB,
  webhookConfigId: string,
  event: string,
  payload: Record<string, unknown>,
  url: string,
  secret: string,
  attempt: number
): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = generateWebhookSignature(body, secret);

  // Create initial log entry
  const [logEntry] = await (db as any)
    .insert(webhookDeliveryLogs)
    .values({
      webhookConfigId,
      event,
      payload,
      attempt,
    })
    .returning({ id: webhookDeliveryLogs.id });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-FanFlow-Signature": signature,
        "X-FanFlow-Event": event,
        "User-Agent": "FanFlow-Webhooks/1.0",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    const responseBody = await response.text().catch(() => "");

    await (db as any)
      .update(webhookDeliveryLogs)
      .set({
        statusCode: response.status,
        responseBody: responseBody.slice(0, 2000),
        deliveredAt: new Date(),
      })
      .where(eq(webhookDeliveryLogs.id, logEntry.id));

    if (!response.ok) {
      throw new Error(`Webhook delivery failed: ${response.status}`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";

    await (db as any)
      .update(webhookDeliveryLogs)
      .set({ error: errorMsg })
      .where(eq(webhookDeliveryLogs.id, logEntry.id));

    throw error; // Re-throw for BullMQ retry
  }
}
