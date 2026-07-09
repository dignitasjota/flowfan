import webpush from "web-push";
import { eq } from "drizzle-orm";
import { pushSubscriptions } from "@/server/db/schema";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("push-notifications");

let configured = false;

/** ¿Están las VAPID keys configuradas? Push degrada a no-op si no. */
export function isPushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT
  );
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

function ensureConfigured(): boolean {
  if (!isPushConfigured()) return false;
  if (!configured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!,
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    );
    configured = true;
  }
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  /** URL a abrir al hacer click en la notificación. */
  url?: string;
  tag?: string;
};

/**
 * Envía una notificación push a todas las suscripciones de un creator (todos
 * sus navegadores/dispositivos y los de su equipo). No-op si push no está
 * configurado. Limpia suscripciones caducadas (410/404).
 */
export async function sendPushToCreator(
  db: any,
  creatorId: string,
  payload: PushPayload
): Promise<{ sent: number; removed: number }> {
  if (!ensureConfigured()) return { sent: 0, removed: 0 };

  const subs = await db.query.pushSubscriptions.findMany({
    where: eq(pushSubscriptions.creatorId, creatorId),
  });
  if (!subs.length) return { sent: 0, removed: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  let removed = 0;

  await Promise.all(
    subs.map(async (sub: any) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body
        );
        sent++;
      } catch (err: any) {
        const status = err?.statusCode;
        // 410 Gone / 404: suscripción muerta → borrar.
        if (status === 410 || status === 404) {
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.id, sub.id))
            .catch(() => {});
          removed++;
        } else {
          log.warn({ status }, "Push send failed");
        }
      }
    })
  );

  return { sent, removed };
}
