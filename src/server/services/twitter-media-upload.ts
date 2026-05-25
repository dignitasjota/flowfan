/**
 * Twitter / X media upload via the v2 endpoint (OAuth 2.0 user context).
 *
 * The legacy v1.1 path needed OAuth 1.0a signing; v2 supports the same Bearer
 * token we already store, so this stays in the same auth flow as posting.
 *
 * Scope required on the user token: `media.write`.
 *
 * For MVP we only handle still images. The creator passes a public URL;
 * we download server-side and upload as multipart to Twitter. Native upload
 * from FanFlow's own storage (S3 / R2) is V2.
 *
 * Per-image budget: 5 MB. Twitter rejects larger payloads via this endpoint.
 */

const TWITTER_MEDIA_URL = "https://upload.twitter.com/2/media/upload";
const MAX_BYTES = 5 * 1024 * 1024;
const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

function guessMime(url: string, fallback: string): string {
  const match = url.toLowerCase().match(/\.(jpg|jpeg|png|webp|gif)(?:\?|#|$)/);
  if (match) return MIME_BY_EXT[match[1]!] ?? fallback;
  return fallback;
}

export type UploadedMedia = {
  mediaId: string;
  mimeType: string;
  sizeBytes: number;
};

export async function uploadTwitterImageFromUrl(args: {
  accessToken: string;
  imageUrl: string;
}): Promise<UploadedMedia> {
  // 1. Fetch the source image (public URL only — no signed URL handling)
  const srcRes = await fetch(args.imageUrl, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!srcRes.ok) {
    throw new Error(
      `Could not fetch image (${srcRes.status}): ${args.imageUrl}`
    );
  }
  const contentType = srcRes.headers.get("content-type") ?? "";
  const mimeType = guessMime(args.imageUrl, contentType || "image/jpeg");
  const buffer = Buffer.from(await srcRes.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(
      `Image is ${Math.round(buffer.byteLength / 1024)}KB — Twitter v2 upload limit is 5MB`
    );
  }

  // 2. Multipart upload to Twitter
  const form = new FormData();
  form.append(
    "media",
    new Blob([new Uint8Array(buffer)], { type: mimeType }),
    "image"
  );
  // Optional category hint; helps Twitter route the asset correctly.
  form.append("media_category", "tweet_image");

  const uploadRes = await fetch(TWITTER_MEDIA_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => "");
    throw new Error(
      `Twitter media upload failed (${uploadRes.status}): ${text.slice(0, 300)}`
    );
  }
  const data = (await uploadRes.json()) as {
    data?: { id?: string; media_key?: string };
    media_id_string?: string; // older shape, fallback
  };
  const mediaId = data.data?.id ?? data.media_id_string;
  if (!mediaId) {
    throw new Error("Twitter media upload: no media id in response");
  }
  return {
    mediaId,
    mimeType,
    sizeBytes: buffer.byteLength,
  };
}
