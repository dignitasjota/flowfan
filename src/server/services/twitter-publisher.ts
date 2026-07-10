import { decrypt, encrypt } from "@/lib/crypto";
import { refreshTwitterToken } from "./oauth-twitter";
import { isVideoUrl } from "@/lib/media";

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
  inReplyToTweetId?: string,
  mediaIds?: string[]
): Promise<{ id: string }> {
  const body: Record<string, unknown> = { text };
  if (inReplyToTweetId) {
    body.reply = { in_reply_to_tweet_id: inReplyToTweetId };
  }
  if (mediaIds && mediaIds.length > 0) {
    body.media = { media_ids: mediaIds.slice(0, 4) }; // Twitter caps at 4 per tweet
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
  /** Public image URLs to attach to the main tweet. Up to 4. */
  mediaUrls?: string[];
}): Promise<TwitterPublishResult> {
  try {
    const threadIds: string[] = [];

    // Upload media first (only if requested). Failures bubble up.
    // X allows either 1 video OR up to 4 images on the same tweet, never
    // both. If both are passed we keep the video and drop the rest with a
    // clear error — silent dropping would mask the user's intent.
    let mediaIds: string[] | undefined;
    if (args.mediaUrls && args.mediaUrls.length > 0) {
      const { uploadTwitterMediaFromUrl } = await import(
        "./twitter-media-upload"
      );
      const videos = args.mediaUrls.filter((u) => isVideoUrl(u));
      const images = args.mediaUrls.filter((u) => !isVideoUrl(u));
      if (videos.length > 0 && images.length > 0) {
        throw new Error(
          "X no permite mezclar vídeo e imágenes en el mismo tweet — usa uno u otro."
        );
      }
      if (videos.length > 1) {
        throw new Error("X solo permite 1 vídeo por tweet.");
      }
      const urls = videos.length > 0 ? videos : images.slice(0, 4);
      mediaIds = [];
      for (const url of urls) {
        const uploaded = await uploadTwitterMediaFromUrl({
          accessToken: args.accessToken,
          mediaUrl: url,
        });
        mediaIds.push(uploaded.mediaId);
      }
    }

    // Main tweet — attaches media if uploaded
    const first = await postTweet(
      args.accessToken,
      args.tweet,
      undefined,
      mediaIds
    );
    threadIds.push(first.id);

    // Follow-up tweets, each reply-chained to the previous.
    // WK-1: el tweet principal YA está publicado. Si un tweet del hilo falla,
    // NO propagamos al catch externo (devolvería success:false y el worker
    // republicaría el principal en el retry, duplicándolo). Registramos el
    // error del hilo aparte y devolvemos éxito con el externalId del principal.
    let threadError: string | undefined;
    if (args.thread && args.thread.length > 0) {
      let parentId = first.id;
      for (const followup of args.thread) {
        if (!followup.trim()) continue;
        try {
          const child = await postTweet(
            args.accessToken,
            followup,
            parentId
          );
          threadIds.push(child.id);
          parentId = child.id;
        } catch (threadErr) {
          threadError = (threadErr as Error).message;
          break;
        }
      }
    }

    const handleForUrl = args.username ?? "i";
    return {
      success: true,
      externalId: first.id,
      externalUrl: `https://twitter.com/${handleForUrl}/status/${first.id}`,
      threadIds,
      ...(threadError
        ? { error: `Tweet principal publicado; el hilo falló parcialmente: ${threadError}` }
        : {}),
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
