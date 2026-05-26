import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { uploadRedditVideoFromUrl } from "@/server/services/reddit-video-upload";

const originalFetch = global.fetch;

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function binRes(bytes: Uint8Array, status = 200): Response {
  return new Response(bytes, { status });
}

describe("uploadRedditVideoFromUrl", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  it("happy path: source fetch + asset lease + S3 multipart → returns CDN URL", async () => {
    const videoBytes = new Uint8Array(1024);
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.startsWith("https://cdn/")) return binRes(videoBytes);
      if (url.endsWith("/api/v1/media/asset.json")) {
        return jsonRes({
          args: {
            action: "https://reddit-uploaded-media.s3-accelerate.amazonaws.com",
            fields: [
              { name: "key", value: "videos/uuid-1.mp4" },
              { name: "X-Amz-Credential", value: "AKIA/..." },
            ],
          },
          asset: { asset_id: "asset-42" },
        });
      }
      if (url.includes("reddit-uploaded-media")) {
        return new Response("<PostResponse/>", { status: 201 });
      }
      throw new Error(`unexpected url=${url}`);
    });
    global.fetch = fetchMock as typeof global.fetch;

    const result = await uploadRedditVideoFromUrl({
      accessToken: "tok",
      videoUrl: "https://cdn/foo.mp4",
    });
    expect(result.mediaUrl).toBe(
      "https://reddit-uploaded-media.s3-accelerate.amazonaws.com/videos/uuid-1.mp4"
    );
    expect(result.assetId).toBe("asset-42");
    expect(result.mimeType).toBe("video/mp4");
    expect(result.sizeBytes).toBe(1024);

    // Sanity: 3 fetches in order — source, lease, upload
    expect(calls.length).toBe(3);
    expect(calls[1].url.endsWith("/asset.json")).toBe(true);
    expect(calls[2].url.includes("reddit-uploaded-media")).toBe(true);
  });

  it("preserves S3 form field order: key first, file last", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://cdn/")) return binRes(new Uint8Array(8));
      if (url.endsWith("/asset.json")) {
        return jsonRes({
          args: {
            action: "https://s3.example/upload",
            fields: [
              { name: "key", value: "abc" },
              { name: "policy", value: "xyz" },
              { name: "X-Amz-Signature", value: "sig" },
            ],
          },
          asset: { asset_id: "a" },
        });
      }
      // S3 upload — capture the form for inspection
      const body = (init?.body as FormData) ?? null;
      expect(body).not.toBeNull();
      const names = Array.from(body!.keys());
      expect(names[0]).toBe("key");
      expect(names[names.length - 1]).toBe("file");
      return new Response(null, { status: 201 });
    });
    global.fetch = fetchMock as typeof global.fetch;

    await uploadRedditVideoFromUrl({
      accessToken: "tok",
      videoUrl: "https://cdn/clip.webm",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws when the lease response is malformed", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith("https://cdn/")) return binRes(new Uint8Array(8));
      if (url.endsWith("/asset.json")) {
        return jsonRes({ args: {} }); // missing action + fields
      }
      throw new Error("nope");
    });
    global.fetch = fetchMock as typeof global.fetch;

    await expect(
      uploadRedditVideoFromUrl({ accessToken: "t", videoUrl: "https://cdn/x.mp4" })
    ).rejects.toThrow(/malformed/);
  });

  it("surfaces non-2xx from the S3 step", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith("https://cdn/")) return binRes(new Uint8Array(8));
      if (url.endsWith("/asset.json")) {
        return jsonRes({
          args: {
            action: "https://s3.example/upload",
            fields: [{ name: "key", value: "k" }],
          },
          asset: { asset_id: "a" },
        });
      }
      return new Response("boom", { status: 403 });
    });
    global.fetch = fetchMock as typeof global.fetch;

    await expect(
      uploadRedditVideoFromUrl({ accessToken: "t", videoUrl: "https://cdn/x.mp4" })
    ).rejects.toThrow(/S3 upload failed \(403\)/);
  });

  it("infers .mov MIME from URL extension", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith("https://cdn/")) return binRes(new Uint8Array(8));
      if (url.endsWith("/asset.json")) {
        return jsonRes({
          args: {
            action: "https://s3.example/u",
            fields: [{ name: "key", value: "k" }],
          },
          asset: { asset_id: "a" },
        });
      }
      return new Response(null, { status: 201 });
    });
    global.fetch = fetchMock as typeof global.fetch;

    const result = await uploadRedditVideoFromUrl({
      accessToken: "t",
      videoUrl: "https://cdn/clip.mov?token=x",
    });
    expect(result.mimeType).toBe("video/quicktime");
  });
});
