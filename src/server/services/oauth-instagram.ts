/**
 * Instagram OAuth via Facebook Login (Instagram Graph API).
 *
 * Instagram Graph API does NOT use Instagram's own OAuth — it uses Facebook
 * Login. The creator must have:
 *   1. An Instagram Business or Creator account.
 *   2. A Facebook Page linked to that Instagram account.
 *
 * Required env vars:
 *   - FB_CLIENT_ID            — Facebook App ID
 *   - FB_CLIENT_SECRET        — Facebook App Secret
 *   - APP_URL                 — base URL of FanFlow
 *
 * Scopes used: pages_show_list, pages_read_engagement, instagram_basic,
 *              instagram_content_publish
 */

export const FB_AUTH_URL = "https://www.facebook.com/v19.0/dialog/oauth";
export const FB_TOKEN_URL = "https://graph.facebook.com/v19.0/oauth/access_token";
export const FB_GRAPH_URL = "https://graph.facebook.com/v19.0";

export const INSTAGRAM_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
  // Required for DELETE /{comment-id} (real platform moderation)
  "instagram_manage_comments",
];

export type InstagramTokens = {
  /** Long-lived user access token (~60 days). */
  accessToken: string;
  expiresInSec: number;
  /** All Instagram Business Accounts linked through this Facebook user. */
  accounts: InstagramAccountInfo[];
};

export type InstagramAccountInfo = {
  /** Instagram Business Account id (the one we publish to). */
  igUserId: string;
  /** Username @ Instagram. */
  username: string;
  /** Facebook Page id that owns the IG account. */
  pageId: string;
  /** Facebook Page name (for display in multi-page UI). */
  pageName: string;
};

export function getInstagramRedirectUri(): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/oauth/instagram/callback`;
}

export function buildInstagramAuthorizationUrl(state: string): string {
  const clientId = process.env.FB_CLIENT_ID;
  if (!clientId) throw new Error("FB_CLIENT_ID is not configured");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getInstagramRedirectUri(),
    state,
    scope: INSTAGRAM_SCOPES.join(","),
    response_type: "code",
  });
  return `${FB_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange code → short-lived → long-lived → resolve IG Business Account.
 * Returns the long-lived token + IG user id we will use for publishing.
 */
export async function exchangeInstagramCode(
  code: string
): Promise<InstagramTokens> {
  const clientId = process.env.FB_CLIENT_ID;
  const clientSecret = process.env.FB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("FB_CLIENT_ID or FB_CLIENT_SECRET not configured");
  }

  // 1. code → short-lived user token
  const shortParams = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getInstagramRedirectUri(),
    code,
  });
  const shortRes = await fetch(`${FB_TOKEN_URL}?${shortParams.toString()}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!shortRes.ok) {
    const text = await shortRes.text().catch(() => "");
    throw new Error(
      `Facebook code exchange failed (${shortRes.status}): ${text.slice(0, 200)}`
    );
  }
  const shortData = (await shortRes.json()) as {
    access_token: string;
    expires_in?: number;
  };

  // 2. short-lived → long-lived (~60 days)
  const longParams = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: clientId,
    client_secret: clientSecret,
    fb_exchange_token: shortData.access_token,
  });
  const longRes = await fetch(`${FB_TOKEN_URL}?${longParams.toString()}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!longRes.ok) {
    const text = await longRes.text().catch(() => "");
    throw new Error(
      `Facebook long-lived exchange failed (${longRes.status}): ${text.slice(
        0,
        200
      )}`
    );
  }
  const longData = (await longRes.json()) as {
    access_token: string;
    expires_in: number;
  };

  // 3. Get the first page connected to this account
  const pagesRes = await fetch(
    `${FB_GRAPH_URL}/me/accounts?access_token=${encodeURIComponent(
      longData.access_token
    )}`,
    { signal: AbortSignal.timeout(15_000) }
  );
  if (!pagesRes.ok) {
    const text = await pagesRes.text().catch(() => "");
    throw new Error(
      `Facebook /me/accounts failed (${pagesRes.status}): ${text.slice(0, 200)}`
    );
  }
  const pagesData = (await pagesRes.json()) as {
    data: { id: string; name: string }[];
  };
  if (pagesData.data.length === 0) {
    throw new Error(
      "No tienes ninguna página de Facebook vinculada. Conecta tu cuenta IG Business a una página de Facebook primero."
    );
  }

  // 4. For each page, resolve its IG Business Account (if any).
  const accounts: InstagramAccountInfo[] = [];
  for (const page of pagesData.data) {
    const igRes = await fetch(
      `${FB_GRAPH_URL}/${page.id}?fields=instagram_business_account&access_token=${encodeURIComponent(
        longData.access_token
      )}`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!igRes.ok) continue;
    const igData = (await igRes.json()) as {
      instagram_business_account?: { id: string };
    };
    const igUserId = igData.instagram_business_account?.id;
    if (!igUserId) continue;

    // Resolve username for display
    let username = "unknown";
    try {
      const infoRes = await fetch(
        `${FB_GRAPH_URL}/${igUserId}?fields=username&access_token=${encodeURIComponent(
          longData.access_token
        )}`,
        { signal: AbortSignal.timeout(10_000) }
      );
      if (infoRes.ok) {
        const d = (await infoRes.json()) as { username?: string };
        if (d.username) username = d.username;
      }
    } catch {
      // best effort
    }

    accounts.push({
      igUserId,
      username,
      pageId: page.id,
      pageName: page.name,
    });
  }

  if (accounts.length === 0) {
    throw new Error(
      "Ninguna de tus páginas de Facebook tiene una cuenta de Instagram Business vinculada."
    );
  }

  return {
    accessToken: longData.access_token,
    expiresInSec: longData.expires_in,
    accounts,
  };
}
