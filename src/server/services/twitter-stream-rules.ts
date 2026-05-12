import { eq, and, isNotNull } from "drizzle-orm";
import { socialPosts, socialAccounts } from "@/server/db/schema";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("twitter-stream-rules");

type DB =
  | Parameters<Parameters<typeof import("@/server/db").db.transaction>[0]>[0]
  | typeof import("@/server/db").db;

export type StreamRule = {
  id: string;
  value: string;
  tag?: string;
};

export const STREAM_RULES_URL =
  "https://api.twitter.com/2/tweets/search/stream/rules";
export const STREAM_URL = "https://api.twitter.com/2/tweets/search/stream";

export function getBearerToken(): string | null {
  return process.env.TWITTER_BEARER_TOKEN ?? null;
}

/** Tag encoding: c:{creatorId}:p:{postId}. Decoded by the worker to route the tweet. */
export function buildRuleTag(creatorId: string, postId: string): string {
  return `c:${creatorId}:p:${postId}`;
}

export function parseRuleTag(
  tag: string | undefined
): { creatorId: string; postId: string } | null {
  if (!tag) return null;
  const match = tag.match(/^c:([0-9a-f-]+):p:([0-9a-f-]+)$/);
  if (!match) return null;
  return { creatorId: match[1]!, postId: match[2]! };
}

async function authedFetch(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const token = getBearerToken();
  if (!token) {
    throw new Error("TWITTER_BEARER_TOKEN not configured");
  }
  const { timeoutMs, ...rest } = init;
  return fetch(url, {
    ...rest,
    headers: {
      ...(rest.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : rest.signal,
  });
}

export async function listStreamRules(): Promise<StreamRule[]> {
  const res = await authedFetch(STREAM_RULES_URL, { timeoutMs: 15_000 });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`list rules failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { data?: StreamRule[] };
  return data.data ?? [];
}

export async function addStreamRules(
  rules: { value: string; tag: string }[]
): Promise<{ created: { id: string; value: string; tag: string }[]; errors: unknown[] }> {
  if (rules.length === 0) return { created: [], errors: [] };
  // Twitter accepts up to 25 rules per request on standard product track
  const batches: typeof rules[] = [];
  for (let i = 0; i < rules.length; i += 25) {
    batches.push(rules.slice(i, i + 25));
  }
  const created: { id: string; value: string; tag: string }[] = [];
  const errors: unknown[] = [];
  for (const batch of batches) {
    const res = await authedFetch(STREAM_RULES_URL, {
      method: "POST",
      body: JSON.stringify({ add: batch }),
      timeoutMs: 20_000,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      errors.push({ status: res.status, body: text.slice(0, 300) });
      continue;
    }
    const data = (await res.json()) as {
      data?: { id: string; value: string; tag?: string }[];
      errors?: unknown[];
      meta?: { summary?: { created?: number; not_created?: number } };
    };
    for (const r of data.data ?? []) {
      if (r.tag) created.push({ id: r.id, value: r.value, tag: r.tag });
    }
    if (data.errors) errors.push(...data.errors);
  }
  return { created, errors };
}

export async function deleteStreamRules(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    const res = await authedFetch(STREAM_RULES_URL, {
      method: "POST",
      body: JSON.stringify({ delete: { ids: slice } }),
      timeoutMs: 20_000,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.warn(
        { status: res.status, body: text.slice(0, 200) },
        "Failed to delete stream rules batch"
      );
    }
  }
}

/**
 * Reconciles Twitter rules with the set of tracked tweets we want to monitor.
 * - Posts with externalPostId but without a remote rule → add.
 * - Remote rules whose tag points to a deleted/untracked post → delete.
 * Stores the rule id in socialPosts.metadata.twitterStreamRuleId for fast lookup.
 */
export async function syncStreamRules(db: DB): Promise<{
  added: number;
  removed: number;
  errors: number;
}> {
  if (!getBearerToken()) {
    return { added: 0, removed: 0, errors: 0 };
  }

  // 1. Need at least one connected Twitter account to bother syncing
  const anyAccount = await (db as any).query.socialAccounts.findFirst({
    where: and(
      eq(socialAccounts.platformType, "twitter"),
      eq(socialAccounts.connectionType, "native"),
      eq(socialAccounts.isActive, true)
    ),
  });
  if (!anyAccount) {
    return { added: 0, removed: 0, errors: 0 };
  }

  // 2. Posts to track: twitter platform + externalPostId set, not archived
  const tracked = await (db as any).query.socialPosts.findMany({
    where: and(
      eq(socialPosts.platformType, "twitter"),
      isNotNull(socialPosts.externalPostId)
    ),
    columns: {
      id: true,
      creatorId: true,
      externalPostId: true,
      metadata: true,
    },
    limit: 800, // stay under the 1000 rules free-tier cap
  });

  const wantedByTag = new Map<
    string,
    { postId: string; creatorId: string; externalPostId: string }
  >();
  for (const p of tracked) {
    if (!p.externalPostId) continue;
    const tag = buildRuleTag(p.creatorId, p.id);
    wantedByTag.set(tag, {
      postId: p.id,
      creatorId: p.creatorId,
      externalPostId: p.externalPostId,
    });
  }

  // 3. Current remote state
  const remote = await listStreamRules();
  const remoteByTag = new Map<string, StreamRule>();
  for (const r of remote) {
    if (r.tag) remoteByTag.set(r.tag, r);
  }

  // 4. Diff
  const toAdd: { value: string; tag: string }[] = [];
  for (const [tag, info] of wantedByTag) {
    if (!remoteByTag.has(tag)) {
      toAdd.push({
        value: `conversation_id:${info.externalPostId} -is:retweet`,
        tag,
      });
    }
  }
  const toRemoveIds: string[] = [];
  for (const [tag, rule] of remoteByTag) {
    // Remove rules whose tag is malformed or points to a post we no longer track
    if (!wantedByTag.has(tag)) toRemoveIds.push(rule.id);
  }

  let added = 0;
  let errors = 0;
  if (toAdd.length > 0) {
    const { created, errors: addErr } = await addStreamRules(toAdd);
    added = created.length;
    errors += addErr.length;

    // Persist the rule id back on the social post for fast lookup
    for (const c of created) {
      const parsed = parseRuleTag(c.tag);
      if (!parsed) continue;
      const post = tracked.find((p: { id: string }) => p.id === parsed.postId);
      if (!post) continue;
      const newMeta = {
        ...((post.metadata as Record<string, unknown>) ?? {}),
        twitterStreamRuleId: c.id,
      };
      await (db as any)
        .update(socialPosts)
        .set({ metadata: newMeta, updatedAt: new Date() })
        .where(eq(socialPosts.id, post.id));
    }
  }

  if (toRemoveIds.length > 0) {
    await deleteStreamRules(toRemoveIds);
  }

  if (added > 0 || toRemoveIds.length > 0) {
    log.info(
      { added, removed: toRemoveIds.length, errors },
      "Twitter stream rules synced"
    );
  }

  return { added, removed: toRemoveIds.length, errors };
}

/** Convenience: add a single rule (used right after a publish). Best-effort. */
export async function addStreamRuleForPost(
  db: DB,
  args: { creatorId: string; postId: string; externalPostId: string }
): Promise<void> {
  if (!getBearerToken()) return;
  const tag = buildRuleTag(args.creatorId, args.postId);
  const { created } = await addStreamRules([
    {
      value: `conversation_id:${args.externalPostId} -is:retweet`,
      tag,
    },
  ]);
  if (created.length === 0) return;
  const ruleId = created[0]!.id;
  const post = await (db as any).query.socialPosts.findFirst({
    where: eq(socialPosts.id, args.postId),
    columns: { metadata: true },
  });
  if (!post) return;
  const newMeta = {
    ...((post.metadata as Record<string, unknown>) ?? {}),
    twitterStreamRuleId: ruleId,
  };
  await (db as any)
    .update(socialPosts)
    .set({ metadata: newMeta, updatedAt: new Date() })
    .where(eq(socialPosts.id, args.postId));
}
