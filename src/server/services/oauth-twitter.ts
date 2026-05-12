import { createHash, randomBytes } from "crypto";

/**
 * Twitter / X OAuth 2.0 (PKCE) helpers.
 *
 * Required env vars:
 *   - TWITTER_CLIENT_ID        — from developer.x.com (OAuth 2.0 client)
 *   - TWITTER_CLIENT_SECRET    — optional for public clients; required for confidential
 *   - APP_URL                  — base URL of FanFlow (used for redirect_uri)
 *
 * Scopes used: tweet.read, tweet.write, users.read, offline.access
 * "offline.access" is required to get a refresh_token.
 */

export const TWITTER_AUTH_URL = "https://twitter.com/i/oauth2/authorize";
export const TWITTER_TOKEN_URL = "https://api.twitter.com/2/oauth2/token";

export const TWITTER_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access",
];

export type TwitterTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number;
  scope: string;
  tokenType: string;
};

/** PKCE: code_verifier (random) + code_challenge (S256). */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest()
    .toString("base64url");
  return { verifier, challenge };
}

export function getTwitterRedirectUri(): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/oauth/twitter/callback`;
}

/** Build the authorization URL the user navigates to. */
export function buildTwitterAuthorizationUrl(args: {
  state: string;
  codeChallenge: string;
}): string {
  const clientId = process.env.TWITTER_CLIENT_ID;
  if (!clientId) throw new Error("TWITTER_CLIENT_ID is not configured");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: getTwitterRedirectUri(),
    scope: TWITTER_SCOPES.join(" "),
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${TWITTER_AUTH_URL}?${params.toString()}`;
}

function buildBasicAuthHeader(): string | null {
  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;
  if (!clientId) return null;
  // Confidential client → Basic auth, public client → omit
  if (!clientSecret) return null;
  return (
    "Basic " +
    Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
  );
}

/** Exchange the authorization code for access + refresh tokens. */
export async function exchangeTwitterCode(args: {
  code: string;
  codeVerifier: string;
}): Promise<TwitterTokens> {
  const clientId = process.env.TWITTER_CLIENT_ID;
  if (!clientId) throw new Error("TWITTER_CLIENT_ID is not configured");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: getTwitterRedirectUri(),
    code_verifier: args.codeVerifier,
    client_id: clientId,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const basic = buildBasicAuthHeader();
  if (basic) headers.Authorization = basic;

  const res = await fetch(TWITTER_TOKEN_URL, {
    method: "POST",
    headers,
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Twitter token exchange failed (${res.status}): ${text.slice(0, 200)}`
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresInSec: data.expires_in,
    scope: data.scope,
    tokenType: data.token_type,
  };
}

/** Use a refresh_token to get a fresh access_token. */
export async function refreshTwitterToken(
  refreshToken: string
): Promise<TwitterTokens> {
  const clientId = process.env.TWITTER_CLIENT_ID;
  if (!clientId) throw new Error("TWITTER_CLIENT_ID is not configured");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const basic = buildBasicAuthHeader();
  if (basic) headers.Authorization = basic;

  const res = await fetch(TWITTER_TOKEN_URL, {
    method: "POST",
    headers,
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Twitter refresh failed (${res.status}): ${text.slice(0, 200)}`
    );
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresInSec: data.expires_in,
    scope: data.scope,
    tokenType: data.token_type,
  };
}

/** Identify the connected account (used post-OAuth to store username + id). */
export async function getTwitterMe(
  accessToken: string
): Promise<{ id: string; username: string; name: string }> {
  const res = await fetch("https://api.twitter.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Twitter /users/me failed (${res.status}): ${text.slice(0, 200)}`
    );
  }
  const data = (await res.json()) as {
    data: { id: string; username: string; name: string };
  };
  return data.data;
}
