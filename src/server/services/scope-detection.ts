/**
 * Detects missing OAuth scopes on a connected social account.
 *
 * Scopes evolve over time as we add features (e.g. instagram_manage_comments
 * for real moderation, media.write for image upload). Tokens issued before
 * the new scope was added stay valid but lack the new permission. The UI
 * surfaces this with a "Reconnect to grant permissions" warning.
 */

import { TWITTER_SCOPES } from "./oauth-twitter";
import { INSTAGRAM_SCOPES } from "./oauth-instagram";

export type ScopeFeatureMap = Record<string, string>;

/**
 * Authoritative list of scopes our publisher / poller / moderation code
 * currently relies on. Keep in sync with what the services actually call.
 * The label is shown in the UI to explain *what* is missing.
 */
const REQUIRED_SCOPES: Record<
  string,
  { scope: string; label: string }[]
> = {
  twitter: [
    { scope: "tweet.write", label: "publicar tweets" },
    { scope: "users.read", label: "identificar tu cuenta" },
    { scope: "offline.access", label: "refresh automático del token" },
    { scope: "media.write", label: "adjuntar imágenes a tweets" },
  ],
  instagram: [
    { scope: "instagram_basic", label: "leer tu cuenta IG" },
    { scope: "instagram_content_publish", label: "publicar posts" },
    { scope: "instagram_manage_comments", label: "moderar comentarios (DELETE)" },
    { scope: "pages_show_list", label: "enumerar páginas de Facebook" },
  ],
};

export type MissingScope = {
  scope: string;
  label: string;
};

export function getMissingScopes(
  platformType: string,
  oauthScopes: string[] | null | undefined,
  connectionType: string
): MissingScope[] {
  if (connectionType !== "native") return [];
  const required = REQUIRED_SCOPES[platformType];
  if (!required) return [];
  const have = new Set(oauthScopes ?? []);
  return required.filter((r) => !have.has(r.scope));
}

/** Default scope list exported from the OAuth service per platform, for UI display. */
export function getCurrentScopeList(platformType: string): string[] {
  if (platformType === "twitter") return TWITTER_SCOPES;
  if (platformType === "instagram") return INSTAGRAM_SCOPES;
  return [];
}
