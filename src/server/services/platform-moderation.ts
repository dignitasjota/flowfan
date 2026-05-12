/**
 * Real moderation actions on the source platform.
 *
 * Capabilities by platform:
 *   - Twitter / X: hide a reply on a tweet the creator owns via
 *     PUT /2/tweets/{id}/hidden. The creator does NOT delete the reply,
 *     they hide it from the public thread view.
 *   - Instagram: delete a comment with DELETE /{comment-id}. Requires the
 *     instagram_manage_comments scope.
 *   - Reddit: not supported by this helper. Reddit's mod API requires the
 *     creator to be a moderator of the subreddit, which is rarely the case
 *     for content creators. Reddit moderation stays creator-side.
 */
export type PlatformModerationAction = "hide" | "unhide" | "delete";

export type PlatformModerationResult =
  | { success: true; note?: string }
  | { success: false; error: string };

export async function applyTwitterModeration(args: {
  accessToken: string;
  externalCommentId: string;
  action: PlatformModerationAction;
}): Promise<PlatformModerationResult> {
  if (args.action === "delete") {
    return {
      success: false,
      error:
        "Twitter no permite borrar replies de terceros desde la cuenta del creador. Usa hide.",
    };
  }
  const hidden = args.action === "hide";
  try {
    const res = await fetch(
      `https://api.twitter.com/2/tweets/${args.externalCommentId}/hidden`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${args.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ hidden }),
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        success: false,
        error: `Twitter PUT /hidden failed (${res.status}): ${text.slice(0, 200)}`,
      };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function applyInstagramModeration(args: {
  accessToken: string;
  externalCommentId: string;
  action: PlatformModerationAction;
}): Promise<PlatformModerationResult> {
  if (args.action !== "delete") {
    // The Graph API does not expose a "hide" toggle for comments; only delete.
    return {
      success: false,
      error:
        "Instagram solo permite borrar comentarios. Selecciona Ocultar localmente.",
    };
  }
  try {
    const params = new URLSearchParams({ access_token: args.accessToken });
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${args.externalCommentId}?${params.toString()}`,
      {
        method: "DELETE",
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        success: false,
        error: `IG DELETE comment failed (${res.status}): ${text.slice(0, 200)}`,
      };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
