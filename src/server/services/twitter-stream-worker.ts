import { eq, and } from "drizzle-orm";
import {
  socialPosts,
  socialComments,
  socialAccounts,
} from "@/server/db/schema";
import {
  getBearerToken,
  parseRuleTag,
  STREAM_URL,
} from "./twitter-stream-rules";
import {
  linkOrCreateCommentAuthor,
  enqueueCommentAnalysis,
} from "./social-comments-ingest";
import { dispatchWebhookEvent } from "./webhook-dispatcher";
import { publishEvent } from "@/lib/redis-pubsub";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("twitter-stream");

type DB =
  | Parameters<Parameters<typeof import("@/server/db").db.transaction>[0]>[0]
  | typeof import("@/server/db").db;

type StreamEvent = {
  data?: {
    id: string;
    text: string;
    author_id?: string;
    conversation_id?: string;
    in_reply_to_user_id?: string;
    created_at?: string;
  };
  includes?: {
    users?: { id: string; username: string; name?: string }[];
  };
  matching_rules?: { id: string; tag?: string }[];
};

let runner: TwitterStreamRunner | null = null;

/**
 * Starts the singleton stream worker. Safe to call multiple times — does
 * nothing if already running or if no bearer token is configured.
 */
export function startTwitterStreamWorker(db: DB): void {
  if (!getBearerToken()) {
    log.info({}, "TWITTER_BEARER_TOKEN not set, stream worker disabled");
    return;
  }
  if (runner) return;
  runner = new TwitterStreamRunner(db);
  runner.start();
}

export async function stopTwitterStreamWorker(): Promise<void> {
  if (!runner) return;
  await runner.stop();
  runner = null;
}

class TwitterStreamRunner {
  private db: DB;
  private controller: AbortController | null = null;
  private stopped = false;
  private reconnectAttempt = 0;

  constructor(db: DB) {
    this.db = db;
  }

  async start(): Promise<void> {
    log.info({}, "Twitter stream worker starting");
    // Fire and forget — the loop handles its own reconnects
    void this.runLoop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.controller?.abort();
  }

  private async runLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.connect();
        // Clean disconnect (server closed the stream) — reconnect after short delay
        this.reconnectAttempt = 0;
        await sleep(2000);
      } catch (err) {
        if (this.stopped) return;
        this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 8);
        const delay = Math.min(60_000, 2 ** this.reconnectAttempt * 1000);
        log.warn(
          { err: (err as Error).message, delay, attempt: this.reconnectAttempt },
          "Twitter stream disconnected; reconnecting"
        );
        await sleep(delay);
      }
    }
  }

  private async connect(): Promise<void> {
    const token = getBearerToken();
    if (!token) throw new Error("No bearer token");

    this.controller = new AbortController();

    const url = new URL(STREAM_URL);
    url.searchParams.set(
      "tweet.fields",
      "author_id,created_at,conversation_id,in_reply_to_user_id"
    );
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "username,name");

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: this.controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`stream connect failed (${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.body) throw new Error("stream body missing");

    log.info({}, "Twitter stream connected");

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Twitter emits one JSON object per line
      let newlineIdx;
      while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (line.length === 0) continue; // keepalive heartbeats
        await this.handleLine(line);
      }
    }
  }

  private async handleLine(line: string): Promise<void> {
    let event: StreamEvent;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (!event.data || !event.matching_rules) return;
    const tweet = event.data;
    const tag = event.matching_rules.find((r) => r.tag)?.tag;
    const parsed = parseRuleTag(tag);
    if (!parsed) return;

    try {
      await this.ingestTweet(parsed.creatorId, parsed.postId, tweet, event.includes);
    } catch (err) {
      log.warn(
        { err: (err as Error).message, tweetId: tweet.id },
        "Failed to ingest streamed tweet"
      );
    }
  }

  private async ingestTweet(
    creatorId: string,
    postId: string,
    tweet: NonNullable<StreamEvent["data"]>,
    includes: StreamEvent["includes"]
  ): Promise<void> {
    if (!tweet.author_id) return;
    const user = includes?.users?.find((u) => u.id === tweet.author_id);
    if (!user) return;

    // Confirm the target post still exists (the rule may be stale)
    const post = await (this.db as any).query.socialPosts.findFirst({
      where: and(
        eq(socialPosts.id, postId),
        eq(socialPosts.creatorId, creatorId)
      ),
    });
    if (!post) return;

    // Skip own-account replies (filtered by rule too, but defensive)
    const account = await (this.db as any).query.socialAccounts.findFirst({
      where: and(
        eq(socialAccounts.creatorId, creatorId),
        eq(socialAccounts.platformType, "twitter"),
        eq(socialAccounts.connectionType, "native")
      ),
      columns: { externalAccountId: true },
    });
    if (account?.externalAccountId === tweet.author_id) return;

    // Dedup with the existing comments insert (unique on externalCommentId)
    const dup = await (this.db as any).query.socialComments.findFirst({
      where: and(
        eq(socialComments.creatorId, creatorId),
        eq(socialComments.platformType, "twitter"),
        eq(socialComments.externalCommentId, tweet.id)
      ),
      columns: { id: true },
    });
    if (dup) return;

    const { contactId } = await linkOrCreateCommentAuthor(
      this.db,
      creatorId,
      "twitter",
      { username: user.username, platformUserId: user.id }
    );

    const [inserted] = await (this.db as any)
      .insert(socialComments)
      .values({
        creatorId,
        postId: post.id,
        platformType: "twitter",
        externalCommentId: tweet.id,
        authorContactId: contactId,
        authorUsername: user.username,
        authorDisplayName: user.name ?? null,
        content: tweet.text,
        role: "fan",
        source: "stream",
        publishedAt: tweet.created_at ? new Date(tweet.created_at) : null,
      })
      .returning();
    if (!inserted) return;

    dispatchWebhookEvent(this.db, creatorId, "comment.received", {
      commentId: inserted.id,
      postId: post.id,
      platformType: "twitter",
      authorUsername: user.username,
      authorContactId: contactId,
      content: tweet.text,
      source: "stream",
    }).catch(() => {});

    enqueueCommentAnalysis({
      creatorId,
      contactId,
      commentId: inserted.id,
      content: tweet.text,
      platformType: "twitter",
    });

    publishEvent(creatorId, {
      type: "new_comment",
      data: {
        commentId: inserted.id,
        postId: post.id,
        platformType: "twitter",
        authorUsername: user.username,
      },
    }).catch(() => {});

    log.info({ tweetId: tweet.id, postId, creatorId }, "Streamed reply ingested");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
