import { Redis } from "ioredis";
import { decrypt } from "@/lib/crypto";

export type RedditCredentials = {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  userAgent?: string;
};

// ---- Redis token cache (50 min TTL — Reddit OAuth tokens last 60 min) ----

const TOKEN_TTL_SECONDS = 50 * 60;

let cacheRedis: Redis | null = null;

function getCacheRedis(): Redis {
  if (!cacheRedis) {
    cacheRedis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    cacheRedis.on("error", () => {
      // Cache failures should never break publishing — fall through to fetch
    });
  }
  return cacheRedis;
}

function tokenCacheKey(creatorId: string): string {
  return `reddit:token:${creatorId}`;
}

export type PublishResult = {
  success: boolean;
  externalId?: string;
  externalUrl?: string;
  error?: string;
};

export const REDDIT_USER_AGENT = "FanFlow/1.0 (by /u/fanflow)";

export function decryptRedditCredentials(
  encryptedCredentials: string
): RedditCredentials {
  const json = decrypt(encryptedCredentials);
  return JSON.parse(json) as RedditCredentials;
}

/**
 * Get a fresh OAuth token from Reddit using password grant
 * (script-type apps only — requires client_id+secret + user/pass).
 */
/**
 * Get a Reddit OAuth token using a Redis-cached value when available.
 * Cache miss → fetch fresh token + store with 50-min TTL.
 * If `creatorId` is omitted, falls through to a direct uncached fetch.
 */
export async function getRedditAccessTokenCached(
  creatorId: string | null,
  creds: RedditCredentials
): Promise<string> {
  if (!creatorId) {
    return getRedditAccessToken(creds);
  }
  try {
    const cached = await getCacheRedis().get(tokenCacheKey(creatorId));
    if (cached) return cached;
  } catch {
    // Redis miss / down — continue to fetch
  }

  const token = await getRedditAccessToken(creds);
  try {
    await getCacheRedis().set(tokenCacheKey(creatorId), token, "EX", TOKEN_TTL_SECONDS);
  } catch {
    // Cache write failure is non-fatal
  }
  return token;
}

/**
 * Invalidate a creator's cached Reddit token. Call this when credentials
 * change or when an authenticated request fails with 401.
 */
export async function invalidateRedditTokenCache(
  creatorId: string
): Promise<void> {
  try {
    await getCacheRedis().del(tokenCacheKey(creatorId));
  } catch {
    // ignore
  }
}

export async function getRedditAccessToken(
  creds: RedditCredentials
): Promise<string> {
  const basic = Buffer.from(
    `${creds.clientId}:${creds.clientSecret}`
  ).toString("base64");

  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": creds.userAgent ?? REDDIT_USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: "password",
      username: creds.username,
      password: creds.password,
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Reddit auth failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    throw new Error(`Reddit auth: no access_token in response (${data.error ?? "unknown"})`);
  }
  return data.access_token;
}

export type RedditPostKind = "self" | "link" | "image";

export async function publishToReddit(
  encryptedCredentials: string,
  post: {
    title: string;
    content: string;
    subreddit: string;
    kind?: RedditPostKind;
    /** Required for kind=link or kind=image. For images Reddit accepts a public URL directly. */
    url?: string;
    flairId?: string;
    nsfw?: boolean;
    spoiler?: boolean;
  },
  /** When provided, the OAuth token is cached in Redis for 50 min */
  creatorId?: string
): Promise<PublishResult> {
  let creds: RedditCredentials;
  try {
    const json = decrypt(encryptedCredentials);
    creds = JSON.parse(json) as RedditCredentials;
  } catch (err) {
    return {
      success: false,
      error: `Invalid stored credentials: ${(err as Error).message}`,
    };
  }

  let token: string;
  try {
    token = await getRedditAccessTokenCached(creatorId ?? null, creds);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }

  const kind: RedditPostKind = post.kind ?? "self";

  if ((kind === "link" || kind === "image") && !post.url) {
    return {
      success: false,
      error: `Reddit ${kind} post requires a url`,
    };
  }

  const body = new URLSearchParams({
    api_type: "json",
    kind,
    sr: post.subreddit,
    title: post.title.slice(0, 300),
    nsfw: post.nsfw ? "true" : "false",
    spoiler: post.spoiler ? "true" : "false",
  });
  if (kind === "self") {
    body.append("text", post.content);
  } else {
    body.append("url", post.url!);
    body.append("resubmit", "true");
  }
  if (post.flairId) body.append("flair_id", post.flairId);

  try {
    const response = await fetch("https://oauth.reddit.com/api/submit", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": creds.userAgent ?? REDDIT_USER_AGENT,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      // 401 means the cached token is stale (revoked / pwd changed).
      // Invalidate so the next call refetches a fresh one.
      if (response.status === 401 && creatorId) {
        await invalidateRedditTokenCache(creatorId);
      }
      return {
        success: false,
        error: `Reddit submit failed (${response.status}): ${text.slice(0, 300)}`,
      };
    }

    const data = (await response.json()) as {
      json?: {
        errors?: string[][];
        data?: { id?: string; name?: string; url?: string };
      };
    };

    const errors = data.json?.errors ?? [];
    if (errors.length > 0) {
      return {
        success: false,
        error: errors.map((e) => e.join(": ")).join("; "),
      };
    }

    return {
      success: true,
      externalId: data.json?.data?.name ?? data.json?.data?.id,
      externalUrl: data.json?.data?.url,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Verify Reddit credentials by attempting an auth handshake (no submission).
 */
export async function verifyRedditCredentials(
  creds: RedditCredentials
): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  try {
    const token = await getRedditAccessToken(creds);
    const meRes = await fetch("https://oauth.reddit.com/api/v1/me", {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": creds.userAgent ?? REDDIT_USER_AGENT,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!meRes.ok) {
      return { ok: false, error: `Reddit /me failed (${meRes.status})` };
    }
    const me = (await meRes.json()) as { name?: string };
    return { ok: true, username: me.name ?? creds.username };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
