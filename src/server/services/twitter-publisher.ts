import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "@/lib/crypto";
import { refreshTwitterToken } from "./oauth-twitter";
import { isVideoUrl } from "@/lib/media";
import { acquireLock, releaseLock } from "@/lib/rate-limit";
import { socialAccounts } from "@/server/db/schema";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("twitter-publisher");

export type TwitterPublishResult =
  | { success: true; externalId: string; externalUrl: string; threadIds: string[] }
  | { success: false; error: string };

type TwitterAccountTokenRow = {
  id: string;
  encryptedOauthAccessToken: string | null;
  encryptedOauthRefreshToken: string | null;
  oauthExpiresAt: Date | null;
};

const TWITTER_REFRESH_LOCK_TTL_MS = 20_000;
const TWITTER_REFRESH_WAIT_MS = 8_000;
const TWITTER_REFRESH_POLL_INTERVAL_MS = 400;

function tokenExpiresSoon(row: TwitterAccountTokenRow): boolean {
  return !row.oauthExpiresAt || row.oauthExpiresAt.getTime() - Date.now() < 60_000;
}

async function readAccountTokenRow(
  db: any,
  accountId: string
): Promise<TwitterAccountTokenRow | null> {
  const row = await db.query.socialAccounts.findFirst({
    where: eq(socialAccounts.id, accountId),
    columns: {
      id: true,
      encryptedOauthAccessToken: true,
      encryptedOauthRefreshToken: true,
      oauthExpiresAt: true,
    },
  });
  return row ?? null;
}

async function persistRefreshedTokens(
  db: any,
  accountId: string,
  tokens: { encryptedOauthAccessToken: string; encryptedOauthRefreshToken: string | null; oauthExpiresAt: Date }
): Promise<void> {
  await db
    .update(socialAccounts)
    .set({ ...tokens, updatedAt: new Date() })
    .where(eq(socialAccounts.id, accountId));
}

/**
 * WK-8: punto único para obtener un access token de Twitter fresco,
 * serializado con un lock distribuido en Redis por `accountId`.
 *
 * Twitter rota el refresh_token en cada uso: si el poller y un scheduled
 * post (u otro caller cualquiera) refrescan a la vez con el mismo
 * refresh_token, Twitter invalida toda la familia y la cuenta queda
 * desconectada hasta re-hacer el OAuth. Un lock por sí solo no basta si cada
 * caller sigue usando el `account` que ya tenía en mano (obsoleto) — por eso,
 * una vez dentro del lock, se relee la fila de `socialAccounts` desde `db`:
 * si otro proceso ya refrescó mientras esperábamos, usamos ese resultado en
 * vez de refrescar (e invalidar) de nuevo.
 *
 * `db` es el cliente de Drizzle (o una transacción) — tipado laxo a
 * propósito, igual que el resto de servicios de este módulo que reciben `db`
 * genérico.
 */
export async function getFreshTwitterAccessToken(
  db: any,
  accountSnapshot: TwitterAccountTokenRow
): Promise<string> {
  if (!tokenExpiresSoon(accountSnapshot)) {
    return decrypt(accountSnapshot.encryptedOauthAccessToken!);
  }

  const lockKey = `twitter_refresh:${accountSnapshot.id}`;
  const lockToken = await acquireLock(lockKey, TWITTER_REFRESH_LOCK_TTL_MS);

  if (!lockToken) {
    // Otro proceso está refrescando esta cuenta ahora mismo: esperamos a que
    // termine y releemos, en vez de refrescar en paralelo con el mismo
    // refresh_token (eso es justo lo que rompe la cuenta).
    const deadline = Date.now() + TWITTER_REFRESH_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, TWITTER_REFRESH_POLL_INTERVAL_MS));
      const fresh = await readAccountTokenRow(db, accountSnapshot.id);
      if (fresh && !tokenExpiresSoon(fresh)) {
        return decrypt(fresh.encryptedOauthAccessToken!);
      }
    }
    log.warn(
      { accountId: accountSnapshot.id },
      "Timed out waiting for concurrent Twitter token refresh — using stale token, expect a possible 401"
    );
    return decrypt(accountSnapshot.encryptedOauthAccessToken!);
  }

  try {
    // Relectura: puede que otro proceso ya haya refrescado justo antes de
    // que consiguiéramos el lock.
    const fresh = (await readAccountTokenRow(db, accountSnapshot.id)) ?? accountSnapshot;
    if (!tokenExpiresSoon(fresh)) {
      return decrypt(fresh.encryptedOauthAccessToken!);
    }
    if (!fresh.encryptedOauthRefreshToken) {
      // Sin refresh token: devolvemos lo que hay y dejamos que el caller
      // descubra el 401 para que surja el aviso de "hay que reconectar".
      return decrypt(fresh.encryptedOauthAccessToken!);
    }

    const refreshDecrypted = decrypt(fresh.encryptedOauthRefreshToken);
    const tokens = await refreshTwitterToken(refreshDecrypted);
    const newAccessEncrypted = encrypt(tokens.accessToken);
    const newRefreshEncrypted = tokens.refreshToken
      ? encrypt(tokens.refreshToken)
      : fresh.encryptedOauthRefreshToken;
    const newExpiresAt = new Date(Date.now() + tokens.expiresInSec * 1000);

    await persistRefreshedTokens(db, accountSnapshot.id, {
      encryptedOauthAccessToken: newAccessEncrypted,
      encryptedOauthRefreshToken: newRefreshEncrypted,
      oauthExpiresAt: newExpiresAt,
    });

    return tokens.accessToken;
  } finally {
    await releaseLock(lockKey, lockToken);
  }
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
