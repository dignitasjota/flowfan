import { eq, and, isNotNull, desc } from "drizzle-orm";
import {
  socialAccounts,
  socialPosts,
  socialComments,
} from "@/server/db/schema";
import { ensureFreshTwitterToken } from "./twitter-publisher";
import {
  linkOrCreateCommentAuthor,
  enqueueCommentAnalysis,
} from "./social-comments-ingest";
import { dispatchWebhookEvent } from "./webhook-dispatcher";
import { publishEvent } from "@/lib/redis-pubsub";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("twitter-poller");

type DB =
  | Parameters<Parameters<typeof import("@/server/db").db.transaction>[0]>[0]
  | typeof import("@/server/db").db;

const POSTS_PER_ACCOUNT = 20;
const REQUEST_DELAY_MS = 1500; // ~40 req/min — Twitter v2 recent search has tight quotas

type TwitterReply = {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  in_reply_to_user_id?: string;
  conversation_id?: string;
};

type TwitterUser = {
  id: string;
  username: string;
  name?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch replies to a tweet using v2 recent search. Returns up to 100 most
 * recent replies matching conversation_id, plus a user lookup keyed by id
 * so we can resolve handles for each reply.
 */
async function fetchTwitterReplies(
  accessToken: string,
  tweetId: string,
  selfUserId: string,
  sinceMs: number | null
): Promise<{ replies: TwitterReply[]; users: Map<string, TwitterUser> }> {
  // -is:retweet excludes RTs; from filters out our own follow-ups in the thread.
  const query = `conversation_id:${tweetId} -from:${selfUserId} -is:retweet`;
  const params = new URLSearchParams({
    query,
    max_results: "100",
    "tweet.fields": "author_id,created_at,in_reply_to_user_id,conversation_id",
    expansions: "author_id",
    "user.fields": "username,name",
  });
  if (sinceMs) {
    params.set("start_time", new Date(sinceMs).toISOString());
  }

  const res = await fetch(
    `https://api.twitter.com/2/tweets/search/recent?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    }
  );

  if (!res.ok) {
    throw new Error(`Twitter search failed (${res.status})`);
  }

  const data = (await res.json()) as {
    data?: TwitterReply[];
    includes?: { users?: TwitterUser[] };
  };
  const users = new Map<string, TwitterUser>();
  for (const u of data.includes?.users ?? []) users.set(u.id, u);
  return { replies: data.data ?? [], users };
}

export async function pollTwitterCommentsForCreator(
  db: DB,
  account: typeof socialAccounts.$inferSelect
): Promise<{ inserted: number; processedPosts: number; errors: number }> {
  if (!account.encryptedOauthAccessToken || !account.externalAccountId) {
    return { inserted: 0, processedPosts: 0, errors: 0 };
  }

  // Ensure fresh token + persist if rotated
  let accessToken: string;
  try {
    const refreshed = await ensureFreshTwitterToken({
      encryptedAccess: account.encryptedOauthAccessToken,
      encryptedRefresh: account.encryptedOauthRefreshToken,
      expiresAt: account.oauthExpiresAt,
    });
    if (refreshed.refreshed) {
      await (db as any)
        .update(socialAccounts)
        .set({
          encryptedOauthAccessToken: refreshed.newAccessEncrypted,
          encryptedOauthRefreshToken: refreshed.newRefreshEncrypted,
          oauthExpiresAt: refreshed.newExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(socialAccounts.id, account.id));
    }
    accessToken = refreshed.accessToken;
  } catch (err) {
    log.warn({ err, creatorId: account.creatorId }, "Twitter token refresh failed");
    await (db as any)
      .update(socialAccounts)
      .set({
        lastErrorMessage: (err as Error).message.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(socialAccounts.id, account.id));
    return { inserted: 0, processedPosts: 0, errors: 1 };
  }

  // Tweets we've published from FanFlow and want to monitor
  const posts = await (db as any).query.socialPosts.findMany({
    where: and(
      eq(socialPosts.creatorId, account.creatorId),
      eq(socialPosts.platformType, "twitter"),
      isNotNull(socialPosts.externalPostId)
    ),
    orderBy: [desc(socialPosts.lastCommentAt), desc(socialPosts.createdAt)],
    limit: POSTS_PER_ACCOUNT,
  });

  let inserted = 0;
  let errors = 0;

  for (const post of posts) {
    if (!post.externalPostId) continue;
    try {
      const sinceMs = post.lastCommentAt
        ? post.lastCommentAt.getTime() - 60_000
        : null;
      const { replies, users } = await fetchTwitterReplies(
        accessToken,
        post.externalPostId,
        account.externalAccountId,
        sinceMs
      );
      if (replies.length === 0) continue;

      const existing = await (db as any).query.socialComments.findMany({
        where: and(
          eq(socialComments.creatorId, account.creatorId),
          eq(socialComments.postId, post.id)
        ),
        columns: { externalCommentId: true },
      });
      const seen = new Set<string>(
        existing
          .map((c: { externalCommentId: string | null }) => c.externalCommentId)
          .filter((x: string | null): x is string => !!x)
      );

      for (const reply of replies) {
        if (!reply.id || !reply.text || !reply.author_id) continue;
        if (seen.has(reply.id)) continue;
        const user = users.get(reply.author_id);
        if (!user) continue;

        const { contactId } = await linkOrCreateCommentAuthor(
          db,
          account.creatorId,
          "twitter",
          { username: user.username, platformUserId: user.id }
        );

        const [insertedRow] = await (db as any)
          .insert(socialComments)
          .values({
            creatorId: account.creatorId,
            postId: post.id,
            platformType: "twitter",
            externalCommentId: reply.id,
            authorContactId: contactId,
            authorUsername: user.username,
            authorDisplayName: user.name ?? null,
            content: reply.text,
            role: "fan",
            source: "polling",
            publishedAt: reply.created_at ? new Date(reply.created_at) : null,
          })
          .returning();
        if (!insertedRow) continue;
        inserted++;
        seen.add(reply.id);

        dispatchWebhookEvent(db, account.creatorId, "comment.received", {
          commentId: insertedRow.id,
          postId: post.id,
          platformType: "twitter",
          authorUsername: user.username,
          authorContactId: contactId,
          content: reply.text,
          source: "polling",
        }).catch(() => {});

        enqueueCommentAnalysis({
          creatorId: account.creatorId,
          contactId,
          commentId: insertedRow.id,
          content: reply.text,
          platformType: "twitter",
        });

        publishEvent(account.creatorId, {
          type: "new_comment",
          data: {
            commentId: insertedRow.id,
            postId: post.id,
            platformType: "twitter",
            authorUsername: user.username,
          },
        }).catch(() => {});
      }

      if (inserted > 0) {
        await (db as any).execute(
          (await import("drizzle-orm")).sql`
            UPDATE social_posts
            SET comments_count = (
              SELECT COUNT(*)::int FROM social_comments
              WHERE social_comments.post_id = social_posts.id
            ),
            unhandled_count = (
              SELECT COUNT(*)::int FROM social_comments
              WHERE social_comments.post_id = social_posts.id
                AND social_comments.is_handled = false
                AND social_comments.role = 'fan'
            ),
            last_comment_at = NOW()
            WHERE social_posts.id = ${post.id}
          `
        );
      }
    } catch (err) {
      errors++;
      log.warn(
        { err, postId: post.id, externalPostId: post.externalPostId },
        "Twitter poll failed for post"
      );
    }
    await sleep(REQUEST_DELAY_MS);
  }

  await (db as any)
    .update(socialAccounts)
    .set({
      lastVerifiedAt: new Date(),
      lastErrorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(socialAccounts.id, account.id));

  return { inserted, processedPosts: posts.length, errors };
}

export async function pollTwitterComments(db: DB): Promise<void> {
  const accounts = await (db as any).query.socialAccounts.findMany({
    where: and(
      eq(socialAccounts.platformType, "twitter"),
      eq(socialAccounts.connectionType, "native"),
      eq(socialAccounts.isActive, true),
    ),
  });

  if (accounts.length === 0) return;

  log.info({ accountCount: accounts.length }, "Starting Twitter poll cycle");

  let totalInserted = 0;
  for (const account of accounts) {
    try {
      const result = await pollTwitterCommentsForCreator(db, account);
      totalInserted += result.inserted;
      if (result.inserted > 0 || result.errors > 0) {
        log.info(
          {
            creatorId: account.creatorId,
            inserted: result.inserted,
            processedPosts: result.processedPosts,
            errors: result.errors,
          },
          "Twitter poll completed for creator"
        );
      }
    } catch (err) {
      log.error({ err, creatorId: account.creatorId }, "Twitter poll failed");
    }
  }

  if (totalInserted > 0) {
    log.info(
      { totalInserted, accountCount: accounts.length },
      "Twitter poll cycle finished"
    );
  }
}

