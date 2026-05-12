import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "@/server/db";
import {
  socialAccounts,
  socialPosts,
  socialComments,
} from "@/server/db/schema";
import {
  linkOrCreateCommentAuthor,
  enqueueCommentAnalysis,
} from "@/server/services/social-comments-ingest";
import { dispatchWebhookEvent } from "@/server/services/webhook-dispatcher";
import { publishEvent } from "@/lib/redis-pubsub";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("ig-webhook");

/**
 * Meta sends a GET with hub.mode=subscribe + hub.challenge during
 * verification. We echo the challenge back when hub.verify_token matches our
 * configured token.
 *
 * Setup in developers.facebook.com → Webhooks:
 *   - Callback URL: {APP_URL}/api/webhooks/instagram
 *   - Verify token: value of META_WEBHOOK_VERIFY_TOKEN
 *   - Subscribe to fields: comments (on the Instagram product)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * Meta delivers events for accounts subscribed to our app. Each entry maps to
 * an Instagram Business Account id. We look up the corresponding creator via
 * socialAccounts.externalAccountId, then insert the comment.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // 1. Verify signature
  const appSecret = process.env.META_WEBHOOK_APP_SECRET;
  if (!appSecret) {
    log.error({}, "META_WEBHOOK_APP_SECRET not configured");
    return new NextResponse("Server misconfigured", { status: 500 });
  }
  const provided = request.headers.get("x-hub-signature-256") ?? "";
  if (!provided.startsWith("sha256=")) {
    return new NextResponse("Missing signature", { status: 401 });
  }
  const expected =
    "sha256=" +
    createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  // 2. Parse payload
  let payload: {
    object?: string;
    entry?: Array<{
      id?: string;
      time?: number;
      changes?: Array<{
        field?: string;
        value?: {
          id?: string; // comment id
          from?: { id?: string; username?: string };
          media?: { id?: string };
          text?: string;
          parent_id?: string;
          created_time?: number;
        };
      }>;
    }>;
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  if (payload.object !== "instagram") {
    // Could be a different webhook subscription tied to the same app — ack but ignore.
    return NextResponse.json({ ok: true, ignored: true });
  }

  let processed = 0;

  for (const entry of payload.entry ?? []) {
    // entry.id is the Instagram Business Account id (matches externalAccountId)
    const igUserId = entry.id;
    if (!igUserId) continue;

    const account = await db.query.socialAccounts.findFirst({
      where: and(
        eq(socialAccounts.platformType, "instagram"),
        eq(socialAccounts.externalAccountId, igUserId),
        eq(socialAccounts.isActive, true)
      ),
    });
    if (!account) {
      log.warn({ igUserId }, "No matching IG account for webhook entry");
      continue;
    }

    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;
      const v = change.value;
      if (!v?.id || !v.text || !v.from?.username || !v.media?.id) continue;

      // Find or create the parent social post (the IG media)
      let post = await db.query.socialPosts.findFirst({
        where: and(
          eq(socialPosts.creatorId, account.creatorId),
          eq(socialPosts.platformType, "instagram"),
          eq(socialPosts.externalPostId, v.media.id)
        ),
      });
      if (!post) {
        const [created] = await db
          .insert(socialPosts)
          .values({
            creatorId: account.creatorId,
            platformType: "instagram",
            externalPostId: v.media.id,
          })
          .returning();
        post = created;
        if (!post) continue;
      }

      // Skip if we've already stored this comment id (replay protection)
      const dup = await db.query.socialComments.findFirst({
        where: and(
          eq(socialComments.creatorId, account.creatorId),
          eq(socialComments.platformType, "instagram"),
          eq(socialComments.externalCommentId, v.id)
        ),
      });
      if (dup) continue;

      const { contactId } = await linkOrCreateCommentAuthor(
        db,
        account.creatorId,
        "instagram",
        {
          username: v.from.username,
          platformUserId: v.from.id ?? null,
        }
      );

      // Resolve parent (top-level vs reply) by external id if present
      let parentCommentId: string | null = null;
      if (v.parent_id) {
        const parent = await db.query.socialComments.findFirst({
          where: and(
            eq(socialComments.creatorId, account.creatorId),
            eq(socialComments.platformType, "instagram"),
            eq(socialComments.externalCommentId, v.parent_id)
          ),
          columns: { id: true },
        });
        if (parent) parentCommentId = parent.id;
      }

      const [inserted] = await db
        .insert(socialComments)
        .values({
          creatorId: account.creatorId,
          postId: post.id,
          parentCommentId,
          platformType: "instagram",
          externalCommentId: v.id,
          authorContactId: contactId,
          authorUsername: v.from.username,
          content: v.text,
          role: "fan",
          source: "webhook",
          publishedAt: v.created_time
            ? new Date(v.created_time * 1000)
            : null,
        })
        .returning();
      if (!inserted) continue;
      processed++;

      dispatchWebhookEvent(
        db,
        account.creatorId,
        "comment.received",
        {
          commentId: inserted.id,
          postId: post.id,
          platformType: "instagram",
          authorUsername: v.from.username,
          authorContactId: contactId,
          content: v.text,
          source: "webhook",
        }
      ).catch(() => {});

      enqueueCommentAnalysis({
        creatorId: account.creatorId,
        contactId,
        commentId: inserted.id,
        content: v.text,
        platformType: "instagram",
      });

      publishEvent(account.creatorId, {
        type: "new_comment",
        data: {
          commentId: inserted.id,
          postId: post.id,
          platformType: "instagram",
          authorUsername: v.from.username,
        },
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, processed });
}
