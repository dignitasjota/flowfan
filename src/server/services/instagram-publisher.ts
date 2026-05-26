import { FB_GRAPH_URL } from "./oauth-instagram";
import { isVideoUrl } from "@/lib/media";

export type InstagramPublishResult =
  | { success: true; externalId: string; externalUrl: string }
  | { success: false; error: string };

/**
 * Container-status polling for Reels.
 *
 * IG ingests the video asynchronously: the `/media` endpoint returns a
 * creation_id immediately but `status_code` walks IN_PROGRESS → FINISHED
 * (or ERROR / EXPIRED) over tens of seconds. We must wait for FINISHED
 * before calling `/media_publish`, otherwise the publish fails with
 * "Media is not ready".
 *
 * Cap: 5-min total wait with 5s polling. Beyond that we surface a
 * timeout error — most legit reels finish under a minute, anything longer
 * is usually stuck and worth surfacing rather than blocking forever.
 */
async function waitForReelContainer(args: {
  accessToken: string;
  creationId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const POLL_INTERVAL_MS = 5_000;
  const MAX_WAIT_MS = 5 * 60_000;
  const started = Date.now();

  while (Date.now() - started < MAX_WAIT_MS) {
    const params = new URLSearchParams({
      fields: "status_code,status",
      access_token: args.accessToken,
    });
    const res = await fetch(
      `${FB_GRAPH_URL}/${args.creationId}?${params.toString()}`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `IG container status fetch failed (${res.status}): ${text.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as { status_code?: string; status?: string };
    const code = data.status_code ?? "";
    if (code === "FINISHED" || code === "PUBLISHED") return { ok: true };
    if (code === "ERROR" || code === "EXPIRED") {
      return {
        ok: false,
        error: `IG container ${code}: ${data.status ?? "(no detail)"}`,
      };
    }
    // IN_PROGRESS or unknown → keep waiting
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  return {
    ok: false,
    error: `IG container did not finish within ${MAX_WAIT_MS / 1000}s — aborting publish`,
  };
}

/**
 * Publishes a single-asset post to Instagram via Graph API.
 *
 * `mediaUrl` may be an image (JPG/PNG) or a video (MP4 for Reels). The
 * publisher detects the kind by URL extension and routes accordingly:
 *
 * IMAGE flow (2 calls, synchronous on Meta's side):
 *   1. POST /{ig_user_id}/media?image_url=...   → creation_id
 *   2. POST /{ig_user_id}/media_publish         → media id
 *
 * VIDEO flow (3 calls + polling — Reels):
 *   1. POST /{ig_user_id}/media?media_type=REELS&video_url=...  → creation_id
 *   2. Poll GET /{creation_id}?fields=status_code until FINISHED
 *   3. POST /{ig_user_id}/media_publish                          → media id
 *
 * The mediaUrl MUST be publicly accessible — IG fetches it server-side and
 * rejects signed URLs that expire quickly.
 */
export async function publishToInstagram(args: {
  accessToken: string;
  igUserId: string;
  /** Public URL of image OR video (Reels). */
  mediaUrl: string;
  caption: string;
}): Promise<InstagramPublishResult> {
  try {
    const isVideo = isVideoUrl(args.mediaUrl);

    // 1. Create the media container
    const createBody: Record<string, string> = {
      caption: args.caption.slice(0, 2200),
      access_token: args.accessToken,
    };
    if (isVideo) {
      createBody.media_type = "REELS";
      createBody.video_url = args.mediaUrl;
    } else {
      createBody.image_url = args.mediaUrl;
    }
    const createRes = await fetch(
      `${FB_GRAPH_URL}/${args.igUserId}/media`,
      {
        method: "POST",
        body: new URLSearchParams(createBody),
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!createRes.ok) {
      const text = await createRes.text().catch(() => "");
      return {
        success: false,
        error: `IG media create failed (${createRes.status}): ${text.slice(0, 300)}`,
      };
    }
    const createData = (await createRes.json()) as { id?: string };
    const creationId = createData.id;
    if (!creationId) {
      return { success: false, error: "IG media create returned no id" };
    }

    // 2. (Video only) Wait for the container to finish ingestion
    if (isVideo) {
      const waited = await waitForReelContainer({
        accessToken: args.accessToken,
        creationId,
      });
      if (!waited.ok) {
        return { success: false, error: waited.error };
      }
    }

    // 3. Publish the container
    const publishParams = new URLSearchParams({
      creation_id: creationId,
      access_token: args.accessToken,
    });
    const publishRes = await fetch(
      `${FB_GRAPH_URL}/${args.igUserId}/media_publish`,
      {
        method: "POST",
        body: publishParams,
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!publishRes.ok) {
      const text = await publishRes.text().catch(() => "");
      return {
        success: false,
        error: `IG media_publish failed (${publishRes.status}): ${text.slice(0, 300)}`,
      };
    }
    const publishData = (await publishRes.json()) as { id?: string };
    const mediaId = publishData.id;
    if (!mediaId) {
      return { success: false, error: "IG media_publish returned no id" };
    }

    return {
      success: true,
      externalId: mediaId,
      externalUrl: `https://www.instagram.com/${isVideo ? "reel" : "p"}/${mediaId}/`,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
