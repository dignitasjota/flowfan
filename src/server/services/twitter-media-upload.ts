/**
 * Twitter / X media upload via the v2 endpoint (OAuth 2.0 user context).
 *
 * v2 supports the same Bearer token we already store, so this stays in the
 * same auth flow as posting. Scope required on the user token: `media.write`.
 *
 * Two paths:
 *  - **Images**: single multipart POST (≤5 MB).
 *  - **Videos**: chunked INIT → APPEND → FINALIZE → STATUS poll. Twitter
 *    transcodes the video asynchronously so we must wait for
 *    `processing_info.state === "succeeded"` before referencing the media_id
 *    in a tweet; otherwise the tweet fails with "media is still being
 *    processed".
 */

import { isVideoUrl } from "@/lib/media";

const TWITTER_MEDIA_URL = "https://upload.twitter.com/2/media/upload";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024; // X limit
const CHUNK_BYTES = 4 * 1024 * 1024; // 4MB per APPEND chunk
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};
const VIDEO_MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/mp4",
  webm: "video/webm",
};

function guessMime(url: string, fallback: string): string {
  const lower = url.toLowerCase();
  const imgMatch = lower.match(/\.(jpg|jpeg|png|webp|gif)(?:\?|#|$)/);
  if (imgMatch) return IMAGE_MIME_BY_EXT[imgMatch[1]!] ?? fallback;
  const vidMatch = lower.match(/\.(mp4|mov|m4v|webm)(?:\?|#|$)/);
  if (vidMatch) return VIDEO_MIME_BY_EXT[vidMatch[1]!] ?? fallback;
  return fallback;
}

export type UploadedMedia = {
  mediaId: string;
  mimeType: string;
  sizeBytes: number;
};

export async function uploadTwitterMediaFromUrl(args: {
  accessToken: string;
  mediaUrl: string;
}): Promise<UploadedMedia> {
  // 1. Fetch the source (public URL only — no signed URL handling)
  const srcRes = await fetch(args.mediaUrl, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!srcRes.ok) {
    throw new Error(
      `Could not fetch media (${srcRes.status}): ${args.mediaUrl}`
    );
  }
  const contentType = srcRes.headers.get("content-type") ?? "";
  const isVideo = isVideoUrl(args.mediaUrl) || contentType.startsWith("video/");
  const fallback = isVideo ? "video/mp4" : "image/jpeg";
  const mimeType = guessMime(args.mediaUrl, contentType || fallback);
  const buffer = Buffer.from(await srcRes.arrayBuffer());

  if (isVideo) {
    if (buffer.byteLength > MAX_VIDEO_BYTES) {
      throw new Error(
        `Video is ${Math.round(buffer.byteLength / 1024 / 1024)}MB — Twitter limit is 512MB`
      );
    }
    return uploadVideoChunked({
      accessToken: args.accessToken,
      buffer,
      mimeType,
    });
  }

  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image is ${Math.round(buffer.byteLength / 1024)}KB — Twitter v2 upload limit is 5MB`
    );
  }
  return uploadImageSinglePart({
    accessToken: args.accessToken,
    buffer,
    mimeType,
  });
}

/** Back-compat alias used by older callers that only handled images. */
export const uploadTwitterImageFromUrl = (args: {
  accessToken: string;
  imageUrl: string;
}) =>
  uploadTwitterMediaFromUrl({
    accessToken: args.accessToken,
    mediaUrl: args.imageUrl,
  });

async function uploadImageSinglePart(args: {
  accessToken: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<UploadedMedia> {
  const form = new FormData();
  form.append(
    "media",
    new Blob([new Uint8Array(args.buffer)], { type: args.mimeType }),
    "image"
  );
  form.append("media_category", "tweet_image");

  const uploadRes = await fetch(TWITTER_MEDIA_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.accessToken}` },
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
    data?: { id?: string };
    media_id_string?: string;
  };
  const mediaId = data.data?.id ?? data.media_id_string;
  if (!mediaId) {
    throw new Error("Twitter media upload: no media id in response");
  }
  return { mediaId, mimeType: args.mimeType, sizeBytes: args.buffer.byteLength };
}

async function twitterCommand(args: {
  accessToken: string;
  form: FormData;
}): Promise<Response> {
  return fetch(TWITTER_MEDIA_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.accessToken}` },
    body: args.form,
    signal: AbortSignal.timeout(60_000),
  });
}

/**
 * Chunked video upload (INIT → APPEND × N → FINALIZE → STATUS poll).
 *
 * STATUS is polled because Twitter transcodes the video asynchronously and
 * tweets referencing a still-processing media_id are rejected. We respect
 * the `check_after_secs` hint when the server provides one; otherwise fall
 * back to 5s polling, capped at 5 minutes total.
 */
async function uploadVideoChunked(args: {
  accessToken: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<UploadedMedia> {
  // INIT
  const initForm = new FormData();
  initForm.append("command", "INIT");
  initForm.append("media_type", args.mimeType);
  initForm.append("media_category", "tweet_video");
  initForm.append("total_bytes", String(args.buffer.byteLength));

  const initRes = await twitterCommand({ accessToken: args.accessToken, form: initForm });
  if (!initRes.ok) {
    const text = await initRes.text().catch(() => "");
    throw new Error(`Twitter INIT failed (${initRes.status}): ${text.slice(0, 300)}`);
  }
  const initData = (await initRes.json()) as {
    data?: { id?: string };
    media_id_string?: string;
  };
  const mediaId = initData.data?.id ?? initData.media_id_string;
  if (!mediaId) throw new Error("Twitter INIT: no media id in response");

  // APPEND (4MB chunks)
  const totalChunks = Math.ceil(args.buffer.byteLength / CHUNK_BYTES);
  for (let segment = 0; segment < totalChunks; segment++) {
    const start = segment * CHUNK_BYTES;
    const end = Math.min(start + CHUNK_BYTES, args.buffer.byteLength);
    const chunk = args.buffer.subarray(start, end);
    const appendForm = new FormData();
    appendForm.append("command", "APPEND");
    appendForm.append("media_id", mediaId);
    appendForm.append("segment_index", String(segment));
    appendForm.append(
      "media",
      new Blob([new Uint8Array(chunk)], { type: args.mimeType }),
      "chunk"
    );
    const appendRes = await twitterCommand({
      accessToken: args.accessToken,
      form: appendForm,
    });
    if (!appendRes.ok) {
      const text = await appendRes.text().catch(() => "");
      throw new Error(
        `Twitter APPEND seg=${segment} failed (${appendRes.status}): ${text.slice(0, 200)}`
      );
    }
  }

  // FINALIZE
  const finalizeForm = new FormData();
  finalizeForm.append("command", "FINALIZE");
  finalizeForm.append("media_id", mediaId);
  const finalRes = await twitterCommand({
    accessToken: args.accessToken,
    form: finalizeForm,
  });
  if (!finalRes.ok) {
    const text = await finalRes.text().catch(() => "");
    throw new Error(`Twitter FINALIZE failed (${finalRes.status}): ${text.slice(0, 300)}`);
  }
  const finalData = (await finalRes.json()) as {
    data?: { processing_info?: ProcessingInfo };
    processing_info?: ProcessingInfo;
  };
  let processing: ProcessingInfo | undefined =
    finalData.data?.processing_info ?? finalData.processing_info;

  // STATUS poll until succeeded / failed / timeout
  const started = Date.now();
  const MAX_WAIT_MS = 5 * 60_000;
  while (processing && processing.state !== "succeeded") {
    if (processing.state === "failed") {
      throw new Error(
        `Twitter media processing failed: ${processing.error?.message ?? "(no detail)"}`
      );
    }
    if (Date.now() - started > MAX_WAIT_MS) {
      throw new Error("Twitter media processing did not finish within 5 min");
    }
    const wait = Math.max(1, processing.check_after_secs ?? 5);
    await new Promise((r) => setTimeout(r, wait * 1000));
    const statusUrl = `${TWITTER_MEDIA_URL}?command=STATUS&media_id=${encodeURIComponent(mediaId)}`;
    const statusRes = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${args.accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!statusRes.ok) {
      const text = await statusRes.text().catch(() => "");
      throw new Error(`Twitter STATUS failed (${statusRes.status}): ${text.slice(0, 200)}`);
    }
    const statusData = (await statusRes.json()) as {
      data?: { processing_info?: ProcessingInfo };
      processing_info?: ProcessingInfo;
    };
    processing = statusData.data?.processing_info ?? statusData.processing_info;
  }

  return { mediaId, mimeType: args.mimeType, sizeBytes: args.buffer.byteLength };
}

type ProcessingInfo = {
  state: "pending" | "in_progress" | "succeeded" | "failed";
  check_after_secs?: number;
  progress_percent?: number;
  error?: { code?: number; name?: string; message?: string };
};
