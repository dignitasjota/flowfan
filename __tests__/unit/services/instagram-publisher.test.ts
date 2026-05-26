import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { publishToInstagram } from "@/server/services/instagram-publisher";

const originalFetch = global.fetch;

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("publishToInstagram", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  it("publishes an image: create container + media_publish, no polling", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ id: "container-1" }))
      .mockResolvedValueOnce(makeJsonResponse({ id: "post-42" }));
    global.fetch = fetchMock as typeof global.fetch;

    const result = await publishToInstagram({
      accessToken: "tok",
      igUserId: "ig-user",
      mediaUrl: "https://cdn/photo.jpg",
      caption: "hi",
    });

    expect(result).toEqual({
      success: true,
      externalId: "post-42",
      externalUrl: "https://www.instagram.com/p/post-42/",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const createBody = String(fetchMock.mock.calls[0][1].body);
    expect(createBody).toContain("image_url=https");
    expect(createBody).not.toContain("media_type=REELS");
  });

  it("publishes a video as a Reel: polls until FINISHED, returns reel URL", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      calls.push(url);
      if (url.includes("/media_publish")) {
        return makeJsonResponse({ id: "reel-99" });
      }
      if (url.endsWith("/ig-user/media")) {
        return makeJsonResponse({ id: "container-7" });
      }
      // STATUS endpoint: returns IN_PROGRESS once, then FINISHED
      const inProgress = calls.filter((u) => u.includes("status_code")).length;
      return makeJsonResponse({
        status_code: inProgress <= 1 ? "IN_PROGRESS" : "FINISHED",
      });
    });
    global.fetch = fetchMock as typeof global.fetch;

    const promise = publishToInstagram({
      accessToken: "tok",
      igUserId: "ig-user",
      mediaUrl: "https://cdn/clip.mp4",
      caption: "hi",
    });
    // Avanza el timer del polling (5s entre intentos)
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await promise;

    expect(result).toEqual({
      success: true,
      externalId: "reel-99",
      externalUrl: "https://www.instagram.com/reel/reel-99/",
    });
    // create + ≥1 status poll + publish
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    const createBody = String(fetchMock.mock.calls[0][1].body);
    expect(createBody).toContain("media_type=REELS");
    expect(createBody).toContain("video_url=https");
  });

  it("returns error when the IG container reports ERROR status", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/ig-user/media")) {
        return makeJsonResponse({ id: "container-bad" });
      }
      return makeJsonResponse({ status_code: "ERROR", status: "FORMAT_BAD" });
    });
    global.fetch = fetchMock as typeof global.fetch;

    const promise = publishToInstagram({
      accessToken: "tok",
      igUserId: "ig-user",
      mediaUrl: "https://cdn/clip.mp4",
      caption: "hi",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/ERROR/);
    }
  });

  it("returns error when /media returns non-2xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("bad", { status: 400 }));
    global.fetch = fetchMock as typeof global.fetch;

    const result = await publishToInstagram({
      accessToken: "tok",
      igUserId: "ig-user",
      mediaUrl: "https://cdn/photo.jpg",
      caption: "hi",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/IG media create failed/);
    }
  });
});
