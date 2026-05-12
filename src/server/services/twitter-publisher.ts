import { decrypt, encrypt } from "@/lib/crypto";
import { refreshTwitterToken } from "./oauth-twitter";

export type TwitterPublishResult =
  | { success: true; externalId: string; externalUrl: string; threadIds: string[] }
  | { success: false; error: string };

/**
 * Returns a fresh access_token, refreshing it via the stored refresh_token
 * if expired. Returns the new tokens so the caller can persist them.
 */
export async function ensureFreshTwitterToken(args: {
  encryptedAccess: string;
  encryptedRefresh: string | null;
  expiresAt: Date | null;
}): Promise<{
  accessToken: string;
  refreshed: boolean;
  newAccessEncrypted?: string;
  newRefreshEncrypted?: string | null;
  newExpiresAt?: Date;
}> {
  let access: string;
  try {
    access = decrypt(args.encryptedAccess);
  } catch (err) {
    throw new Error(`Stored access token is invalid: ${(err as Error).message}`);
  }

  const expiresSoon =
    args.expiresAt && args.expiresAt.getTime() - Date.now() < 60_000;
  if (!expiresSoon) {
    return { accessToken: access, refreshed: false };
  }

  if (!args.encryptedRefresh) {
    // No refresh token stored — return whatever we have and let the caller
    // discover the 401 to surface a reconnect-needed error.
    return { accessToken: access, refreshed: false };
  }

  const refreshDecrypted = decrypt(args.encryptedRefresh);
  const tokens = await refreshTwitterToken(refreshDecrypted);
  const newAccessEncrypted = encrypt(tokens.accessToken);
  const newRefreshEncrypted = tokens.refreshToken
    ? encrypt(tokens.refreshToken)
    : args.encryptedRefresh;
  const newExpiresAt = new Date(Date.now() + tokens.expiresInSec * 1000);
  return {
    accessToken: tokens.accessToken,
    refreshed: true,
    newAccessEncrypted,
    newRefreshEncrypted,
    newExpiresAt,
  };
}

async function postTweet(
  accessToken: string,
  text: string,
  inReplyToTweetId?: string
): Promise<{ id: string }> {
  const body: Record<string, unknown> = { text };
  if (inReplyToTweetId) {
    body.reply = { in_reply_to_tweet_id: inReplyToTweetId };
  }

  const res = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    const err = new Error(
      `Twitter POST /tweets failed (${res.status}): ${errorText.slice(0, 300)}`
    );
    // Tag the error so the caller can detect 401 to invalidate the cache
    (err as Error & { statusCode?: number }).statusCode = res.status;
    throw err;
  }

  const data = (await res.json()) as { data: { id: string; text: string } };
  return { id: data.data.id };
}

export async function publishToTwitter(args: {
  accessToken: string;
  tweet: string;
  thread?: string[];
  username?: string;
}): Promise<TwitterPublishResult> {
  try {
    const threadIds: string[] = [];

    // Main tweet
    const first = await postTweet(args.accessToken, args.tweet);
    threadIds.push(first.id);

    // Follow-up tweets, each reply-chained to the previous
    if (args.thread && args.thread.length > 0) {
      let parentId = first.id;
      for (const followup of args.thread) {
        if (!followup.trim()) continue;
        const child = await postTweet(
          args.accessToken,
          followup,
          parentId
        );
        threadIds.push(child.id);
        parentId = child.id;
      }
    }

    const handleForUrl = args.username ?? "i";
    return {
      success: true,
      externalId: first.id,
      externalUrl: `https://twitter.com/${handleForUrl}/status/${first.id}`,
      threadIds,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
