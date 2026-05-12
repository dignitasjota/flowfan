import { FB_GRAPH_URL } from "./oauth-instagram";

export type InstagramPublishResult =
  | { success: true; externalId: string; externalUrl: string }
  | { success: false; error: string };

/**
 * Publishes a single-image post to Instagram via Graph API.
 *
 * Requires a publicly accessible imageUrl — Instagram fetches the image
 * itself and rejects private URLs / signed URLs that expire too fast.
 *
 * For MVP we assume the creator hosts media on imgur / a public CDN. Native
 * upload from FanFlow's own media vault requires S3 + a public bucket, which
 * is V2.
 *
 * The publish flow is two-step:
 *   1. POST /{ig_user_id}/media   → returns a creation_id (the container).
 *   2. POST /{ig_user_id}/media_publish with creation_id → the actual post.
 */
export async function publishToInstagram(args: {
  accessToken: string;
  igUserId: string;
  imageUrl: string;
  caption: string;
}): Promise<InstagramPublishResult> {
  try {
    // 1. Create the media container
    const createParams = new URLSearchParams({
      image_url: args.imageUrl,
      caption: args.caption.slice(0, 2200),
      access_token: args.accessToken,
    });
    const createRes = await fetch(
      `${FB_GRAPH_URL}/${args.igUserId}/media`,
      {
        method: "POST",
        body: createParams,
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

    // 2. Publish the container
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
      externalUrl: `https://www.instagram.com/p/${mediaId}/`,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
