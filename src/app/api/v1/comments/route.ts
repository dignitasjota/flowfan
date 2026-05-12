import { NextResponse, type NextRequest } from "next/server";
import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "@/server/db";
import { authenticateApiKey } from "@/server/api/middleware/api-key-auth";
import {
  socialPosts,
  socialComments,
} from "@/server/db/schema";
import { dispatchWebhookEvent } from "@/server/services/webhook-dispatcher";
import {
  linkOrCreateCommentAuthor,
  enqueueCommentAnalysis,
} from "@/server/services/social-comments-ingest";
import { publishEvent } from "@/lib/redis-pubsub";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";

const ALLOWED_PLATFORMS = new Set(["instagram", "reddit", "twitter"]);

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const postId = searchParams.get("post_id");
  const onlyUnhandled = searchParams.get("unhandled") === "true";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(
    100,
    Math.max(1, Number(searchParams.get("limit")) || 50)
  );
  const offset = (page - 1) * limit;

  const conditions = [eq(socialComments.creatorId, auth.creatorId)];
  if (postId) conditions.push(eq(socialComments.postId, postId));
  if (onlyUnhandled) conditions.push(eq(socialComments.isHandled, false));

  const rows = await db
    .select({
      id: socialComments.id,
      postId: socialComments.postId,
      parentCommentId: socialComments.parentCommentId,
      platformType: socialComments.platformType,
      authorContactId: socialComments.authorContactId,
      authorUsername: socialComments.authorUsername,
      authorDisplayName: socialComments.authorDisplayName,
      content: socialComments.content,
      role: socialComments.role,
      isHandled: socialComments.isHandled,
      handledAt: socialComments.handledAt,
      publishedAt: socialComments.publishedAt,
      createdAt: socialComments.createdAt,
    })
    .from(socialComments)
    .where(and(...conditions))
    .orderBy(desc(socialComments.createdAt))
    .limit(limit)
    .offset(offset);

  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(socialComments)
    .where(and(...conditions));

  return NextResponse.json({
    data: rows,
    pagination: {
      page,
      limit,
      total: total?.count ?? 0,
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  if (auth.accessLevel !== "full") {
    return NextResponse.json(
      { error: "Write access requires Business plan" },
      { status: 403 }
    );
  }

  // Endpoint-specific rate limit (stricter than the global per-key limit
  // applied in the auth middleware). Prevents accidental flood of inserts
  // from misconfigured clients.
  const rl = await rateLimit(
    `comments-ingest:${auth.keyId}`,
    RATE_LIMITS.commentsIngest
  );
  if (!rl.success) {
    return NextResponse.json(
      {
        error:
          "Rate limit exceeded for POST /api/v1/comments. Try again after the window resets.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": Math.max(1, rl.resetAt - Math.floor(Date.now() / 1000)).toString(),
          "X-RateLimit-Limit": RATE_LIMITS.commentsIngest.limit.toString(),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": rl.resetAt.toString(),
        },
      }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    platformType,
    externalPostId,
    postUrl,
    postTitle,
    postContent,
    externalCommentId,
    parentExternalCommentId,
    authorUsername,
    authorDisplayName,
    authorAvatarUrl,
    authorPlatformUserId,
    content,
    publishedAt,
  } = body as Record<string, string | undefined>;

  if (!platformType || !ALLOWED_PLATFORMS.has(platformType)) {
    return NextResponse.json(
      { error: "platformType must be one of: instagram, reddit, twitter" },
      { status: 400 }
    );
  }
  if (!authorUsername || !content) {
    return NextResponse.json(
      { error: "authorUsername and content are required" },
      { status: 400 }
    );
  }
  if (!externalPostId && !postUrl) {
    return NextResponse.json(
      { error: "externalPostId or postUrl is required to identify the post" },
      { status: 400 }
    );
  }

  // Find or create the post
  let post = externalPostId
    ? await db.query.socialPosts.findFirst({
        where: and(
          eq(socialPosts.creatorId, auth.creatorId),
          eq(socialPosts.platformType, platformType as "instagram" | "reddit" | "twitter"),
          eq(socialPosts.externalPostId, externalPostId)
        ),
      })
    : null;

  if (!post) {
    const [created] = await db
      .insert(socialPosts)
      .values({
        creatorId: auth.creatorId,
        platformType: platformType as "instagram" | "reddit" | "twitter",
        externalPostId: externalPostId ?? null,
        url: postUrl ?? null,
        title: postTitle ?? null,
        content: postContent ?? null,
      })
      .returning();
    post = created;
  }

  if (!post) {
    return NextResponse.json(
      { error: "Failed to create post" },
      { status: 500 }
    );
  }

  // Resolve parent comment by external id (if provided)
  let parentCommentId: string | null = null;
  if (parentExternalCommentId) {
    const parent = await db.query.socialComments.findFirst({
      where: and(
        eq(socialComments.creatorId, auth.creatorId),
        eq(socialComments.platformType, platformType as "instagram" | "reddit" | "twitter"),
        eq(socialComments.externalCommentId, parentExternalCommentId)
      ),
    });
    if (parent) parentCommentId = parent.id;
  }

  // Resolve or create the contact for the comment author
  const { contactId: authorContactId } = await linkOrCreateCommentAuthor(
    db,
    auth.creatorId,
    platformType as "instagram" | "reddit" | "twitter",
    {
      username: authorUsername,
      displayName: authorDisplayName,
      avatarUrl: authorAvatarUrl,
      platformUserId: authorPlatformUserId,
    }
  );

  // Idempotency: skip duplicate by external comment id
  if (externalCommentId) {
    const existing = await db.query.socialComments.findFirst({
      where: and(
        eq(socialComments.creatorId, auth.creatorId),
        eq(socialComments.platformType, platformType as "instagram" | "reddit" | "twitter"),
        eq(socialComments.externalCommentId, externalCommentId)
      ),
    });
    if (existing) {
      return NextResponse.json({ data: existing, deduplicated: true }, { status: 200 });
    }
  }

  const [comment] = await db
    .insert(socialComments)
    .values({
      creatorId: auth.creatorId,
      postId: post.id,
      parentCommentId,
      platformType: platformType as "instagram" | "reddit" | "twitter",
      externalCommentId: externalCommentId ?? null,
      authorContactId,
      authorUsername,
      authorDisplayName: authorDisplayName ?? null,
      authorAvatarUrl: authorAvatarUrl ?? null,
      content,
      role: "fan",
      source: "api",
      publishedAt: publishedAt ? new Date(publishedAt) : null,
    })
    .returning();

  await db
    .update(socialPosts)
    .set({
      commentsCount: sql`${socialPosts.commentsCount} + 1`,
      unhandledCount: sql`${socialPosts.unhandledCount} + 1`,
      lastCommentAt: new Date(),
    })
    .where(eq(socialPosts.id, post.id));

  dispatchWebhookEvent(db, auth.creatorId, "comment.received", {
    commentId: comment!.id,
    postId: post.id,
    platformType,
    authorUsername,
    authorContactId,
    content,
  }).catch(() => {});

  // Enqueue scoring/sentiment analysis on the comment
  enqueueCommentAnalysis({
    creatorId: auth.creatorId,
    contactId: authorContactId,
    commentId: comment!.id,
    content: content!,
    platformType: platformType!,
  });

  // Realtime push to the dashboard
  publishEvent(auth.creatorId, {
    type: "new_comment",
    data: {
      commentId: comment!.id,
      postId: post.id,
      platformType,
      authorUsername,
    },
  }).catch(() => {});

  return NextResponse.json({ data: comment }, { status: 201 });
}
