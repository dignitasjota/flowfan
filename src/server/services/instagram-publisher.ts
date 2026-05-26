import { FB_GRAPH_URL } from "./oauth-instagram";
import { isVideoUrl } from "@/lib/media";
import { fetchWithRetry } from "./poll-retry";

export type InstagramPublishResult =
  | { success: true; externalId: string; externalUrl: string }
  | { success: false; error: string };

/**
 * Container-status polling for async media (Reels + carousel parents).
 *
 * IG ingests video/carousel asynchronously: `/media` returns a creation_id
 * immediately but `status_code` walks IN_PROGRESS → FINISHED (or ERROR /
 * EXPIRED) over tens of seconds. We must wait for FINISHED before calling
 * `/media_publish`, otherwise the publish fails with "Media is not ready".
 *
 * Cap: 5-min total wait with 5s polling. Beyond that we surface a
 * timeout error — most legit reels finish under a minute, anything longer
 * is usually stuck and worth surfacing rather than blocking forever.
 */
async function waitForContainer(args: {
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
    // fetchWithRetry absorbe 5xx + errores de red transitorios. 4xx pasan
    // tal cual y se surface al caller (auth, container no existe, etc).
    let res: Response;
    try {
      res = await fetchWithRetry(
        `${FB_GRAPH_URL}/${args.creationId}?${params.toString()}`,
        { signal: AbortSignal.timeout(15_000) }
      );
    } catch (err) {
      return {
        ok: false,
        error: `IG container status network error: ${(err as Error).message}`,
      };
    }
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
 * Creates a single (non-carousel) media container.
 *
 * For carousel children we use `is_carousel_item=true` instead of attaching
 * the caption (the caption lives on the parent container only).
 */
async function createMediaContainer(args: {
  accessToken: string;
  igUserId: string;
  mediaUrl: string;
  caption?: string;
  asCarouselChild?: boolean;
}): Promise<{ ok: true; creationId: string; isVideo: boolean } | { ok: false; error: string }> {
  const isVideo = isVideoUrl(args.mediaUrl);
  const body: Record<string, string> = {
    access_token: args.accessToken,
  };
  if (isVideo) {
    body.media_type = "REELS";
    body.video_url = args.mediaUrl;
  } else {
    body.image_url = args.mediaUrl;
  }
  if (args.asCarouselChild) {
    body.is_carousel_item = "true";
  } else if (args.caption) {
    body.caption = args.caption.slice(0, 2200);
  }

  const res = await fetch(`${FB_GRAPH_URL}/${args.igUserId}/media`, {
    method: "POST",
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      error: `IG media create failed (${res.status}): ${text.slice(0, 300)}`,
    };
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) return { ok: false, error: "IG media create returned no id" };
  return { ok: true, creationId: data.id, isVideo };
}

async function publishContainer(args: {
  accessToken: string;
  igUserId: string;
  creationId: string;
}): Promise<{ ok: true; mediaId: string } | { ok: false; error: string }> {
  const res = await fetch(`${FB_GRAPH_URL}/${args.igUserId}/media_publish`, {
    method: "POST",
    body: new URLSearchParams({
      creation_id: args.creationId,
      access_token: args.accessToken,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      error: `IG media_publish failed (${res.status}): ${text.slice(0, 300)}`,
    };
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) return { ok: false, error: "IG media_publish returned no id" };
  return { ok: true, mediaId: data.id };
}

/**
 * Publishes a post to Instagram via Graph API. Accepts a single image, a
 * single Reel, or a carousel (mixed images + videos, 2-10 items).
 *
 * SINGLE IMAGE flow (2 calls, synchronous):
 *   /media?image_url=… → /media_publish
 *
 * SINGLE REEL flow (3 calls + polling):
 *   /media?media_type=REELS&video_url=… → poll status → /media_publish
 *
 * CAROUSEL flow (N+2 calls, parent polled before publish):
 *   N × /media?is_carousel_item=true (image_url OR REELS+video_url)
 *   → /media?media_type=CAROUSEL&children=id1,id2,… → poll → /media_publish
 *
 * All URLs must be publicly accessible — IG fetches them server-side and
 * rejects signed URLs that expire quickly.
 */
export async function publishToInstagram(args: {
  accessToken: string;
  igUserId: string;
  /** Public URLs (1-10). 1 → single post or Reel. 2-10 → carousel. */
  mediaUrls: string[];
  caption: string;
}): Promise<InstagramPublishResult> {
  try {
    const urls = args.mediaUrls.filter(Boolean);
    if (urls.length === 0) {
      return { success: false, error: "Instagram requires at least one mediaUrl" };
    }
    if (urls.length > 10) {
      return { success: false, error: "Instagram carousel allows up to 10 items" };
    }

    const isCarousel = urls.length > 1;

    // Single-item: container directly; carousel: build children then parent
    let containerId: string;
    let isVideoSingle = false;

    if (!isCarousel) {
      const created = await createMediaContainer({
        accessToken: args.accessToken,
        igUserId: args.igUserId,
        mediaUrl: urls[0],
        caption: args.caption,
      });
      if (!created.ok) return { success: false, error: created.error };
      containerId = created.creationId;
      isVideoSingle = created.isVideo;

      // Reels: wait for ingestion
      if (created.isVideo) {
        const waited = await waitForContainer({
          accessToken: args.accessToken,
          creationId: containerId,
        });
        if (!waited.ok) return { success: false, error: waited.error };
      }
    } else {
      const childIds: string[] = [];
      let anyVideo = false;
      for (const url of urls) {
        const child = await createMediaContainer({
          accessToken: args.accessToken,
          igUserId: args.igUserId,
          mediaUrl: url,
          asCarouselChild: true,
        });
        if (!child.ok) return { success: false, error: child.error };
        childIds.push(child.creationId);
        if (child.isVideo) anyVideo = true;
      }
      // Video children must finish ingesting before the parent is created
      if (anyVideo) {
        for (const id of childIds) {
          const waited = await waitForContainer({
            accessToken: args.accessToken,
            creationId: id,
          });
          if (!waited.ok) return { success: false, error: waited.error };
        }
      }

      const parentRes = await fetch(`${FB_GRAPH_URL}/${args.igUserId}/media`, {
        method: "POST",
        body: new URLSearchParams({
          media_type: "CAROUSEL",
          children: childIds.join(","),
          caption: args.caption.slice(0, 2200),
          access_token: args.accessToken,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!parentRes.ok) {
        const text = await parentRes.text().catch(() => "");
        return {
          success: false,
          error: `IG carousel parent create failed (${parentRes.status}): ${text.slice(0, 300)}`,
        };
      }
      const parentData = (await parentRes.json()) as { id?: string };
      if (!parentData.id) {
        return { success: false, error: "IG carousel parent: no id in response" };
      }
      containerId = parentData.id;
      // Parent also goes through async finalization once children are ready
      const waited = await waitForContainer({
        accessToken: args.accessToken,
        creationId: containerId,
      });
      if (!waited.ok) return { success: false, error: waited.error };
    }

    const published = await publishContainer({
      accessToken: args.accessToken,
      igUserId: args.igUserId,
      creationId: containerId,
    });
    if (!published.ok) return { success: false, error: published.error };

    // URL slug: /reel/ for single Reels, /p/ for image / carousel
    const slug = !isCarousel && isVideoSingle ? "reel" : "p";
    return {
      success: true,
      externalId: published.mediaId,
      externalUrl: `https://www.instagram.com/${slug}/${published.mediaId}/`,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
