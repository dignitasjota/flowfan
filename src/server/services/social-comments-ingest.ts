import { eq, and } from "drizzle-orm";
import { contacts, contactProfiles } from "@/server/db/schema";
import { dispatchWebhookEvent } from "./webhook-dispatcher";
import { analysisQueue } from "@/server/queues";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("social-comments-ingest");

type DB =
  | Parameters<Parameters<typeof import("@/server/db").db.transaction>[0]>[0]
  | typeof import("@/server/db").db;

export type CommentAuthor = {
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  platformUserId?: string | null;
};

/**
 * Resolve the contact id for a comment author, creating a "lightweight"
 * contact + empty profile if none exists. This is what lets a fan who only
 * comments (never DMs) advance through the funnel.
 *
 * Match priority: platformUserId → username → create new.
 */
export async function linkOrCreateCommentAuthor(
  db: DB,
  creatorId: string,
  platformType: "instagram" | "reddit" | "twitter",
  author: CommentAuthor
): Promise<{ contactId: string; created: boolean }> {
  if (author.platformUserId) {
    const existing = await (db as any).query.contacts.findFirst({
      where: and(
        eq(contacts.creatorId, creatorId),
        eq(contacts.platformType, platformType),
        eq(contacts.platformUserId, author.platformUserId)
      ),
    });
    if (existing) return { contactId: existing.id, created: false };
  }

  const byUsername = await (db as any).query.contacts.findFirst({
    where: and(
      eq(contacts.creatorId, creatorId),
      eq(contacts.platformType, platformType),
      eq(contacts.username, author.username)
    ),
  });
  if (byUsername) return { contactId: byUsername.id, created: false };

  // Create lightweight contact + empty profile
  const [contact] = await (db as any)
    .insert(contacts)
    .values({
      creatorId,
      username: author.username,
      displayName: author.displayName ?? null,
      avatarUrl: author.avatarUrl ?? null,
      platformType,
      platformUserId: author.platformUserId ?? null,
      metadata: { source: "comment" },
      totalConversations: 0,
    })
    .returning();

  if (!contact) {
    throw new Error("Failed to create contact for comment author");
  }

  await (db as any).insert(contactProfiles).values({ contactId: contact.id });

  dispatchWebhookEvent(db, creatorId, "contact.created", {
    contactId: contact.id,
    username: author.username,
    platformType,
    source: "comment",
  }).catch(() => {});

  return { contactId: contact.id, created: true };
}

/**
 * Enqueue an analysis job for a public comment so it runs through the same
 * scoring + churn + sentiment pipeline as DMs. Source="comment" tells the
 * worker to write sentiment back to socialComments rather than messages.
 */
export function enqueueCommentAnalysis(params: {
  creatorId: string;
  contactId: string;
  commentId: string;
  content: string;
  platformType: string;
  threadHistory?: { role: string; content: string }[];
}): void {
  analysisQueue
    .add("analyze", {
      creatorId: params.creatorId,
      contactId: params.contactId,
      messageId: params.commentId,
      conversationId: "",
      messageContent: params.content,
      platformType: params.platformType,
      conversationHistory: params.threadHistory ?? [],
      source: "comment",
    })
    .catch((err) => {
      log.warn({ err, commentId: params.commentId }, "Failed to enqueue comment analysis");
    });
}
