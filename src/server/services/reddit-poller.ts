import { eq, and, isNotNull, desc } from "drizzle-orm";
import {
  socialAccounts,
  socialPosts,
  socialComments,
} from "@/server/db/schema";
import {
  getRedditAccessTokenCached,
  decryptRedditCredentials,
  REDDIT_USER_AGENT,
} from "./scheduler-publisher";
import {
  linkOrCreateCommentAuthor,
  enqueueCommentAnalysis,
} from "./social-comments-ingest";
import { dispatchWebhookEvent } from "./webhook-dispatcher";
import { publishEvent } from "@/lib/redis-pubsub";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("reddit-poller");

type DB =
  | Parameters<Parameters<typeof import("@/server/db").db.transaction>[0]>[0]
  | typeof import("@/server/db").db;

const POSTS_PER_ACCOUNT = 30; // most recent reddit posts to poll per cycle
const REQUEST_DELAY_MS = 1100; // ~55 req/min, under the 60/min OAuth limit

type RedditCommentNode = {
  kind: "t1" | "more" | string;
  data: {
    id?: string;
    name?: string;
    author?: string;
    body?: string;
    parent_id?: string;
    created_utc?: number;
    permalink?: string;
    replies?: { data?: { children?: RedditCommentNode[] } } | "";
  };
};

export function flattenComments(
  children: RedditCommentNode[] | undefined,
  out: RedditCommentNode["data"][] = []
): RedditCommentNode["data"][] {
  if (!children) return out;
  for (const node of children) {
    if (node.kind !== "t1") continue;
    if (node.data.author === "[deleted]" || !node.data.body) continue;
    out.push(node.data);
    const replies = node.data.replies;
    if (replies && typeof replies !== "string") {
      flattenComments(replies.data?.children, out);
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRedditComments(
  token: string,
  postId: string,
  limit = 100
): Promise<RedditCommentNode["data"][]> {
  // postId may be stored as full name "t3_abc123" or just "abc123"
  const id = postId.startsWith("t3_") ? postId.slice(3) : postId;
  const url = `https://oauth.reddit.com/comments/${id}.json?limit=${limit}&depth=2&sort=new`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": REDDIT_USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Reddit comments fetch failed (${res.status})`);
  }

  const data = (await res.json()) as Array<{
    data?: { children?: RedditCommentNode[] };
  }>;
  // First element is the post listing, second is the comments listing
  const commentsListing = data[1];
  return flattenComments(commentsListing?.data?.children);
}

export async function pollRedditCommentsForCreator(
  db: DB,
  account: typeof socialAccounts.$inferSelect
): Promise<{ inserted: number; processedPosts: number; errors: number }> {
  if (!account.encryptedCredentials) {
    return { inserted: 0, processedPosts: 0, errors: 0 };
  }

  let token: string;
  try {
    const creds = decryptRedditCredentials(account.encryptedCredentials);
    token = await getRedditAccessTokenCached(account.creatorId, creds);
  } catch (err) {
    log.warn(
      { err, creatorId: account.creatorId },
      "Reddit auth failed during polling"
    );
    await (db as any)
      .update(socialAccounts)
      .set({
        lastErrorMessage: (err as Error).message.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(socialAccounts.id, account.id));
    return { inserted: 0, processedPosts: 0, errors: 1 };
  }

  const posts = await (db as any).query.socialPosts.findMany({
    where: and(
      eq(socialPosts.creatorId, account.creatorId),
      eq(socialPosts.platformType, "reddit"),
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
      const comments = await fetchRedditComments(token, post.externalPostId);
      if (comments.length === 0) continue;

      // Load existing externalCommentIds for this post in a single query
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

      const ownUsername = account.accountUsername?.toLowerCase();

      for (const c of comments) {
        if (!c.id || !c.body || !c.author) continue;
        const fullName = c.name ?? `t1_${c.id}`;
        if (seen.has(fullName)) continue;
        if (
          ownUsername &&
          c.author.toLowerCase() === ownUsername
        ) {
          // Skip comments authored by the connected account itself
          continue;
        }

        const parentFullName = c.parent_id ?? "";
        const parentInThread = parentFullName.startsWith("t1_")
          ? parentFullName
          : null;
        let parentCommentId: string | null = null;
        if (parentInThread) {
          const parent = await (db as any).query.socialComments.findFirst({
            where: and(
              eq(socialComments.creatorId, account.creatorId),
              eq(socialComments.platformType, "reddit"),
              eq(socialComments.externalCommentId, parentInThread)
            ),
            columns: { id: true },
          });
          if (parent) parentCommentId = parent.id;
        }

        const { contactId } = await linkOrCreateCommentAuthor(
          db,
          account.creatorId,
          "reddit",
          { username: c.author, platformUserId: c.author }
        );

        const [inserted_row] = await (db as any)
          .insert(socialComments)
          .values({
            creatorId: account.creatorId,
            postId: post.id,
            parentCommentId,
            platformType: "reddit",
            externalCommentId: fullName,
            authorContactId: contactId,
            authorUsername: c.author,
            content: c.body,
            role: "fan",
            source: "polling",
            publishedAt: c.created_utc
              ? new Date(c.created_utc * 1000)
              : null,
            metadata: c.permalink ? { permalink: c.permalink } : {},
          })
          .returning();

        if (!inserted_row) continue;
        inserted++;
        seen.add(fullName);

        dispatchWebhookEvent(db, account.creatorId, "comment.received", {
          commentId: inserted_row.id,
          postId: post.id,
          platformType: "reddit",
          authorUsername: c.author,
          authorContactId: contactId,
          content: c.body,
          source: "polling",
        }).catch(() => {});

        enqueueCommentAnalysis({
          creatorId: account.creatorId,
          contactId,
          commentId: inserted_row.id,
          content: c.body,
          platformType: "reddit",
        });

        publishEvent(account.creatorId, {
          type: "new_comment",
          data: {
            commentId: inserted_row.id,
            postId: post.id,
            platformType: "reddit",
            authorUsername: c.author,
          },
        }).catch(() => {});
      }

      if (inserted > 0) {
        // Refresh post counters from DB-level aggregates
        await (db as any).execute(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        "Reddit poll failed for post"
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

export async function pollRedditComments(db: DB): Promise<void> {
  const accounts = await (db as any).query.socialAccounts.findMany({
    where: and(
      eq(socialAccounts.platformType, "reddit"),
      eq(socialAccounts.connectionType, "native"),
      eq(socialAccounts.isActive, true)
    ),
  });

  if (accounts.length === 0) return;

  log.info({ accountCount: accounts.length }, "Starting Reddit poll cycle");

  let totalInserted = 0;
  for (const account of accounts) {
    try {
      const result = await pollRedditCommentsForCreator(db, account);
      totalInserted += result.inserted;
      if (result.inserted > 0 || result.errors > 0) {
        log.info(
          {
            creatorId: account.creatorId,
            inserted: result.inserted,
            processedPosts: result.processedPosts,
            errors: result.errors,
          },
          "Reddit poll completed for creator"
        );
      }
    } catch (err) {
      log.error(
        { err, creatorId: account.creatorId },
        "Reddit poll failed for creator"
      );
    }
  }

  if (totalInserted > 0) {
    log.info(
      { totalInserted, accountCount: accounts.length },
      "Reddit poll cycle finished"
    );
  }
}
