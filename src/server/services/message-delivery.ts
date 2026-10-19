import { eq } from "drizzle-orm";
import { conversations, contacts } from "@/server/db/schema";
import { telegramOutgoingQueue } from "@/server/queues";
import { publishEvent } from "@/lib/redis-pubsub";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("message-delivery");

type Db = typeof import("@/server/db").db;

/**
 * Efectos de un mensaje de creador ya insertado en `messages` por un proceso
 * automático (secuencias, workflows): evento realtime y, si la conversación es
 * de Telegram, envío real por el bot. Antes estos mensajes se guardaban pero
 * nunca llegaban al fan.
 *
 * Para el resto de plataformas no hay API de DM: el mensaje queda registrado
 * para que el creador lo envíe manualmente.
 */
export async function deliverAutomatedCreatorMessage(
  db: Db,
  args: { creatorId: string; conversationId: string; messageId: string; content: string; source: string }
): Promise<void> {
  publishEvent(args.creatorId, {
    type: "new_message",
    data: {
      conversationId: args.conversationId,
      messageId: args.messageId,
      role: "creator",
      source: args.source,
    },
  }).catch(() => {});

  try {
    const conversation = await db.query.conversations.findFirst({
      where: eq(conversations.id, args.conversationId),
      columns: { platformType: true, contactId: true },
    });
    if (conversation?.platformType !== "telegram") return;

    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.id, conversation.contactId),
      columns: { platformUserId: true },
    });
    if (!contact?.platformUserId) return;

    await telegramOutgoingQueue.add(
      "send",
      {
        creatorId: args.creatorId,
        chatId: contact.platformUserId,
        text: args.content,
        conversationId: args.conversationId,
        messageId: args.messageId,
      },
      { jobId: `tg-out-${args.messageId}` }
    );
  } catch (err) {
    log.warn({ err, messageId: args.messageId }, "Failed to deliver automated message");
  }
}
