import { decrypt } from "@/lib/crypto";

export type RedditCredentials = {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  userAgent?: string;
};

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
  }
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
    token = await getRedditAccessToken(creds);
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
