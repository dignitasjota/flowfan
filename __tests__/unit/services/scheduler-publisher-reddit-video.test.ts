import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocks ANTES del import del módulo bajo test, para que la primera carga
// reciba las versiones mockeadas. `publishToReddit` resuelve credenciales
// via decrypt() y delega el upload de vídeo en reddit-video-upload.
vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn(() =>
    JSON.stringify({
      clientId: "cid",
      clientSecret: "secret",
      username: "u",
      password: "p",
    })
  ),
  encrypt: vi.fn(),
}));

vi.mock("@/server/services/reddit-video-upload", () => ({
  uploadRedditVideoFromUrl: vi.fn(),
}));

import { publishToReddit } from "@/server/services/scheduler-publisher";
import { uploadRedditVideoFromUrl } from "@/server/services/reddit-video-upload";

const mockUpload = vi.mocked(uploadRedditVideoFromUrl);
const originalFetch = global.fetch;

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("publishToReddit kind=video", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpload.mockResolvedValue({
      mediaUrl:
        "https://reddit-uploaded-media.s3-accelerate.amazonaws.com/v/abc.mp4",
      assetId: "asset-1",
      mimeType: "video/mp4",
      sizeBytes: 1024,
    });
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("happy path: uploads via helper then submits with kind=video + poster", async () => {
    const submitBodies: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: { body?: string }) => {
      if (url.endsWith("/access_token")) {
        return jsonRes({ access_token: "token-abc" });
      }
      if (url.endsWith("/api/submit")) {
        if (init?.body) submitBodies.push(init.body);
        return jsonRes({
          json: { data: { id: "abc", name: "t3_abc", url: "https://reddit.com/r/foo/abc" } },
        });
      }
      throw new Error(`unexpected url=${url}`);
    });
    global.fetch = fetchMock as typeof global.fetch;

    const result = await publishToReddit("encrypted-creds", {
      title: "Cool video",
      content: "",
      subreddit: "videos",
      kind: "video",
      url: "https://cdn.r2/clip.mp4",
      posterUrl: "https://cdn.r2/poster.jpg",
    });

    expect(result).toEqual({
      success: true,
      externalId: "t3_abc",
      externalUrl: "https://reddit.com/r/foo/abc",
    });
    // El helper recibió el accessToken obtenido y la URL del source
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "token-abc",
        videoUrl: "https://cdn.r2/clip.mp4",
      })
    );
    // El submit usa la URL Reddit-hosted (no la R2 original) + video_poster_url
    expect(submitBodies).toHaveLength(1);
    const body = submitBodies[0];
    expect(body).toContain("kind=video");
    expect(body).toContain("url=https%3A%2F%2Freddit-uploaded-media");
    expect(body).not.toContain("cdn.r2%2Fclip.mp4"); // la R2 source no debe filtrarse
    expect(body).toContain(
      "video_poster_url=https%3A%2F%2Fcdn.r2%2Fposter.jpg"
    );
    expect(body).toContain("resubmit=true");
  });

  it("returns error when posterUrl is missing", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonRes({ access_token: "tok" })) as typeof global.fetch;
    const result = await publishToReddit("encrypted-creds", {
      title: "x",
      content: "",
      subreddit: "videos",
      kind: "video",
      url: "https://cdn.r2/clip.mp4",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/posterUrl/);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("returns error when url is missing", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonRes({ access_token: "tok" })) as typeof global.fetch;
    const result = await publishToReddit("encrypted-creds", {
      title: "x",
      content: "",
      subreddit: "videos",
      kind: "video",
      posterUrl: "https://cdn.r2/poster.jpg",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/requires a url/);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("propagates upload failure as a publish error (no submit call)", async () => {
    mockUpload.mockRejectedValue(new Error("S3 upload failed (403)"));
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/access_token")) return jsonRes({ access_token: "tok" });
      throw new Error(`/api/submit should not be called`);
    });
    global.fetch = fetchMock as typeof global.fetch;

    const result = await publishToReddit("encrypted-creds", {
      title: "x",
      content: "",
      subreddit: "videos",
      kind: "video",
      url: "https://cdn.r2/clip.mp4",
      posterUrl: "https://cdn.r2/poster.jpg",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/S3 upload failed/);
    // El submit no se debe haber llamado
    const submitCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith("/api/submit")
    );
    expect(submitCalls).toHaveLength(0);
  });

  it("surfaces Reddit submit-level errors (json.errors[])", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/access_token")) return jsonRes({ access_token: "tok" });
      return jsonRes({
        json: { errors: [["BAD_VIDEO", "Subreddit doesn't allow video"]] },
      });
    });
    global.fetch = fetchMock as typeof global.fetch;

    const result = await publishToReddit("encrypted-creds", {
      title: "x",
      content: "",
      subreddit: "noVideoSub",
      kind: "video",
      url: "https://cdn.r2/clip.mp4",
      posterUrl: "https://cdn.r2/poster.jpg",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/BAD_VIDEO/);
  });
});
