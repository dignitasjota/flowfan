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
      mediaUrls: ["https://cdn/photo.jpg"],
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
      const inProgress = calls.filter((u) => u.includes("status_code")).length;
      return makeJsonResponse({
        status_code: inProgress <= 1 ? "IN_PROGRESS" : "FINISHED",
      });
    });
    global.fetch = fetchMock as typeof global.fetch;

    const promise = publishToInstagram({
      accessToken: "tok",
      igUserId: "ig-user",
      mediaUrls: ["https://cdn/clip.mp4"],
      caption: "hi",
    });
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await promise;

    expect(result).toEqual({
      success: true,
      externalId: "reel-99",
      externalUrl: "https://www.instagram.com/reel/reel-99/",
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    const createBody = String(fetchMock.mock.calls[0][1].body);
    expect(createBody).toContain("media_type=REELS");
    expect(createBody).toContain("video_url=https");
  });

  it("publishes a carousel of 3 images: 3 children + parent + publish", async () => {
    const requests: { url: string; body: string }[] = [];
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: { body?: BodyInit }) => {
      const body = String(init?.body ?? "");
      requests.push({ url, body });

      if (url.includes("/media_publish")) {
        return makeJsonResponse({ id: "carousel-post-1" });
      }
      if (url.includes("status_code")) {
        return makeJsonResponse({ status_code: "FINISHED" });
      }
      if (url.endsWith("/ig-user/media")) {
        if (body.includes("media_type=CAROUSEL")) {
          return makeJsonResponse({ id: "parent-1" });
        }
        const idx = requests.filter(
          (r) => r.url.endsWith("/ig-user/media") && r.body.includes("is_carousel_item=true")
        ).length;
        return makeJsonResponse({ id: `child-${idx}` });
      }
      throw new Error(`unexpected url=${url}`);
    });
    global.fetch = fetchMock as typeof global.fetch;

    const promise = publishToInstagram({
      accessToken: "tok",
      igUserId: "ig-user",
      mediaUrls: [
        "https://cdn/a.jpg",
        "https://cdn/b.jpg",
        "https://cdn/c.jpg",
      ],
      caption: "carousel",
    });
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await promise;

    expect(result).toEqual({
      success: true,
      externalId: "carousel-post-1",
      externalUrl: "https://www.instagram.com/p/carousel-post-1/",
    });

    // 3 children + 1 parent + status poll + publish
    const childCalls = requests.filter(
      (r) => r.url.endsWith("/ig-user/media") && r.body.includes("is_carousel_item=true")
    );
    expect(childCalls).toHaveLength(3);
    // Caption should ONLY appear on the carousel parent, not on children
    expect(childCalls.every((c) => !c.body.includes("caption="))).toBe(true);
    const parentCall = requests.find((r) => r.body.includes("media_type=CAROUSEL"));
    expect(parentCall).toBeDefined();
    expect(parentCall!.body).toContain("caption=carousel");
    expect(parentCall!.body).toContain("children=child-1%2Cchild-2%2Cchild-3");
  });

  it("carousel with video children: polls each child before creating the parent", async () => {
    const calls: { url: string; body: string }[] = [];
    let videoChildStatusChecks = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: { body?: BodyInit }) => {
      const body = String(init?.body ?? "");
      calls.push({ url, body });
      if (url.includes("/media_publish")) {
        return makeJsonResponse({ id: "carousel-2" });
      }
      if (url.includes("status_code")) {
        // child videos report IN_PROGRESS once, then FINISHED
        videoChildStatusChecks++;
        return makeJsonResponse({
          status_code: videoChildStatusChecks <= 1 ? "IN_PROGRESS" : "FINISHED",
        });
      }
      if (url.endsWith("/ig-user/media")) {
        if (body.includes("media_type=CAROUSEL")) {
          return makeJsonResponse({ id: "parent-2" });
        }
        const childIdx = calls.filter(
          (c) =>
            c.url.endsWith("/ig-user/media") &&
            c.body.includes("is_carousel_item=true")
        ).length;
        return makeJsonResponse({ id: `child-v-${childIdx}` });
      }
      throw new Error("unexpected");
    });
    global.fetch = fetchMock as typeof global.fetch;

    const promise = publishToInstagram({
      accessToken: "tok",
      igUserId: "ig-user",
      mediaUrls: ["https://cdn/a.mp4", "https://cdn/b.jpg"],
      caption: "mixed",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await promise;
    expect(result.success).toBe(true);
    // status polls fired for the child(ren) before the parent creation
    const parentIdx = calls.findIndex((c) => c.body.includes("media_type=CAROUSEL"));
    const statusIdxsBeforeParent = calls
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.url.includes("status_code"))
      .map(({ i }) => i);
    expect(statusIdxsBeforeParent.some((i) => i < parentIdx)).toBe(true);
  });

  it("carousel: fails fast when a child container returns non-2xx (no parent created)", async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: { body?: BodyInit }) => {
      const body = String(init?.body ?? "");
      calls.push({ url, body });
      if (url.endsWith("/ig-user/media")) {
        const childIdx = calls.filter(
          (c) =>
            c.url.endsWith("/ig-user/media") &&
            c.body.includes("is_carousel_item=true")
        ).length;
        if (childIdx === 2) {
          // second child fails outright
          return new Response("bad asset", { status: 400 });
        }
        return makeJsonResponse({ id: `child-${childIdx}` });
      }
      throw new Error(`unexpected url=${url}`);
    });
    global.fetch = fetchMock as typeof global.fetch;

    const result = await publishToInstagram({
      accessToken: "tok",
      igUserId: "ig-user",
      mediaUrls: ["https://cdn/a.jpg", "https://cdn/b.jpg", "https://cdn/c.jpg"],
      caption: "x",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/IG media create failed \(400\)/);
    // No parent, no publish should have been attempted
    expect(calls.find((c) => c.body.includes("media_type=CAROUSEL"))).toBeUndefined();
    expect(calls.find((c) => c.url.includes("/media_publish"))).toBeUndefined();
  });

  it("carousel: surfaces ERROR on a video child status before creating parent", async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: { body?: BodyInit }) => {
      const body = String(init?.body ?? "");
      calls.push({ url, body });
      if (url.includes("status_code")) {
        return makeJsonResponse({ status_code: "ERROR", status: "FORMAT_BAD" });
      }
      if (url.endsWith("/ig-user/media")) {
        if (body.includes("media_type=CAROUSEL")) {
          return makeJsonResponse({ id: "should-not-happen" });
        }
        const childIdx = calls.filter(
          (c) =>
            c.url.endsWith("/ig-user/media") &&
            c.body.includes("is_carousel_item=true")
        ).length;
        return makeJsonResponse({ id: `child-v-${childIdx}` });
      }
      throw new Error("unexpected");
    });
    global.fetch = fetchMock as typeof global.fetch;

    const promise = publishToInstagram({
      accessToken: "tok",
      igUserId: "ig-user",
      mediaUrls: ["https://cdn/a.mp4", "https://cdn/b.jpg"],
      caption: "mixed",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/ERROR/);
    // Parent must not have been created if a child errored out
    expect(calls.find((c) => c.body.includes("media_type=CAROUSEL"))).toBeUndefined();
  });

  it("carousel: ERROR on the parent's own status aborts before publish", async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: { body?: BodyInit }) => {
      const body = String(init?.body ?? "");
      calls.push({ url, body });
      if (url.includes("/media_publish")) {
        return makeJsonResponse({ id: "should-not-happen" });
      }
      if (url.includes("status_code")) {
        // Asume que el caller distingue child vs parent por el id en la URL,
        // pero el publisher actual polingea ambos contra el mismo endpoint;
        // simulamos que TODOS los status devuelven ERROR para forzar el
        // abort en el primer polling tras crear los children.
        return makeJsonResponse({ status_code: "ERROR", status: "PARENT_BAD" });
      }
      if (url.endsWith("/ig-user/media")) {
        if (body.includes("media_type=CAROUSEL")) {
          return makeJsonResponse({ id: "parent-99" });
        }
        const childIdx = calls.filter(
          (c) =>
            c.url.endsWith("/ig-user/media") &&
            c.body.includes("is_carousel_item=true")
        ).length;
        // All children imagen — para que no se polingue antes del parent
        return makeJsonResponse({ id: `child-i-${childIdx}` });
      }
      throw new Error("unexpected");
    });
    global.fetch = fetchMock as typeof global.fetch;

    const promise = publishToInstagram({
      accessToken: "tok",
      igUserId: "ig-user",
      mediaUrls: ["https://cdn/a.jpg", "https://cdn/b.jpg"],
      caption: "imgs",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/PARENT_BAD|ERROR/);
    expect(calls.find((c) => c.url.includes("/media_publish"))).toBeUndefined();
  });

  it("rejects more than 10 items", async () => {
    const result = await publishToInstagram({
      accessToken: "tok",
      igUserId: "ig-user",
      mediaUrls: Array.from({ length: 11 }, (_, i) => `https://cdn/${i}.jpg`),
      caption: "x",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/10/);
  });

  it("rejects empty mediaUrls", async () => {
    const result = await publishToInstagram({
      accessToken: "tok",
      igUserId: "ig-user",
      mediaUrls: [],
      caption: "x",
    });
    expect(result.success).toBe(false);
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
      mediaUrls: ["https://cdn/clip.mp4"],
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
      mediaUrls: ["https://cdn/photo.jpg"],
      caption: "hi",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/IG media create failed/);
    }
  });
});
