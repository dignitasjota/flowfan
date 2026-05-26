/**
 * Reddit video upload helper.
 *
 * Unlike images (which Reddit accepts as plain external URLs), videos must
 * live on Reddit's own CDN. The flow is:
 *
 *   1. POST /api/v1/media/asset.json     — get an S3-compatible upload lease
 *   2. POST {lease.action}                — multipart upload of the bytes
 *   3. POST /api/submit?kind=video       — using the uploaded URL + a poster
 *
 * This module covers steps 1 and 2 and returns the final media URL that the
 * caller passes to `/api/submit`. The poster image is handled by the caller
 * (Reddit also needs a public JPG/PNG URL for the thumbnail).
 */

import { REDDIT_USER_AGENT } from "./scheduler-publisher";

type AssetLeaseField = { name: string; value: string };

type AssetLease = {
  args: {
    action: string; // base URL of the S3-style upload
    fields: AssetLeaseField[];
  };
  asset: { asset_id: string };
};

const VIDEO_MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/mp4",
  webm: "video/webm",
};

function guessVideoMime(url: string, fallback: string): string {
  const match = url.toLowerCase().match(/\.(mp4|mov|m4v|webm)(?:\?|#|$)/);
  if (match) return VIDEO_MIME_BY_EXT[match[1]!] ?? fallback;
  return fallback;
}

function basenameFromUrl(url: string, fallbackExt: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last && last.includes(".")) return last;
    return `upload.${fallbackExt}`;
  } catch {
    return `upload.${fallbackExt}`;
  }
}

export type RedditVideoUpload = {
  /** URL Reddit will host: `${lease.action}/${key}`. Use this in /api/submit. */
  mediaUrl: string;
  assetId: string;
  mimeType: string;
  sizeBytes: number;
};

/**
 * Download the video from a public URL and upload it to Reddit's S3 lease.
 * Returns the public URL Reddit will recognize on `kind=video` submit.
 */
export async function uploadRedditVideoFromUrl(args: {
  accessToken: string;
  videoUrl: string;
  userAgent?: string;
}): Promise<RedditVideoUpload> {
  const ua = args.userAgent ?? REDDIT_USER_AGENT;

  // 1. Fetch the source video (public URL — R2 / CDN)
  const srcRes = await fetch(args.videoUrl, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!srcRes.ok) {
    throw new Error(
      `Could not fetch video (${srcRes.status}): ${args.videoUrl}`
    );
  }
  const contentType = srcRes.headers.get("content-type") ?? "";
  const mimeType = guessVideoMime(args.videoUrl, contentType || "video/mp4");
  const buffer = Buffer.from(await srcRes.arrayBuffer());
  const ext = mimeType.split("/")[1] ?? "mp4";
  const filename = basenameFromUrl(args.videoUrl, ext);

  // 2. Ask Reddit for an upload lease
  const leaseRes = await fetch(
    "https://oauth.reddit.com/api/v1/media/asset.json",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": ua,
      },
      body: new URLSearchParams({
        filepath: filename,
        mimetype: mimeType,
      }).toString(),
      signal: AbortSignal.timeout(20_000),
    }
  );
  if (!leaseRes.ok) {
    const text = await leaseRes.text().catch(() => "");
    throw new Error(
      `Reddit asset lease failed (${leaseRes.status}): ${text.slice(0, 300)}`
    );
  }
  const lease = (await leaseRes.json()) as AssetLease;
  if (!lease?.args?.action || !Array.isArray(lease.args.fields)) {
    throw new Error("Reddit asset lease: malformed response");
  }
  const keyField = lease.args.fields.find((f) => f.name === "key");
  if (!keyField) {
    throw new Error("Reddit asset lease: response missing 'key' field");
  }

  // 3. Multipart upload to the lease action.
  // Reddit's S3-compatible endpoint requires the policy fields to come
  // BEFORE the file part, and the file part to be named "file". Browser /
  // node FormData preserve insertion order.
  const form = new FormData();
  for (const f of lease.args.fields) {
    form.append(f.name, f.value);
  }
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: mimeType }),
    filename
  );

  const action = lease.args.action.startsWith("//")
    ? `https:${lease.args.action}`
    : lease.args.action;

  const uploadRes = await fetch(action, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => "");
    throw new Error(
      `Reddit S3 upload failed (${uploadRes.status}): ${text.slice(0, 300)}`
    );
  }

  // 4. The final URL Reddit recognizes for submit
  const baseAction = action.replace(/\/$/, "");
  const mediaUrl = `${baseAction}/${keyField.value}`;

  return {
    mediaUrl,
    assetId: lease.asset.asset_id,
    mimeType,
    sizeBytes: buffer.byteLength,
  };
}
