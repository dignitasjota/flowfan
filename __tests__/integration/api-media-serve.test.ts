import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  authOptions: {},
}));

vi.mock("@/server/db", () => ({
  db: {
    query: {
      mediaItems: { findFirst: vi.fn() },
    },
  },
}));

vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { db } from "@/server/db";
import { readFile } from "fs/promises";
import { GET } from "@/app/api/media/[id]/route";

const mockSession = vi.mocked(getServerSession);
const mockFindFirst = vi.mocked(db.query.mediaItems.findFirst);
const mockReadFile = vi.mocked(readFile);

function makeReq(url: string): Request {
  return new Request(url);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const SAMPLE_ITEM = {
  id: "11111111-1111-1111-1111-111111111111",
  creatorId: "creator-1",
  storagePath: "creator-1/file.jpg",
  thumbnailPath: "creator-1/file_thumb.webp",
  publicUrl: null as string | null,
  mimeType: "image/jpeg",
} as never;

describe("GET /api/media/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: "creator-1" } } as never);
  });

  it("returns 401 when there is no session", async () => {
    mockSession.mockResolvedValue(null);
    const res = await GET(
      makeReq("http://localhost/api/media/abc"),
      makeParams("abc")
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when the item is not found", async () => {
    mockFindFirst.mockResolvedValue(undefined as never);
    const res = await GET(
      makeReq("http://localhost/api/media/abc"),
      makeParams("abc")
    );
    expect(res.status).toBe(404);
  });

  it("redirects (302) to publicUrl when it exists and thumb is not requested", async () => {
    mockFindFirst.mockResolvedValue({
      ...SAMPLE_ITEM,
      publicUrl: "https://cdn.fanflow.app/creators/c1/file.jpg",
    });
    const res = await GET(
      makeReq("http://localhost/api/media/abc"),
      makeParams("abc")
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://cdn.fanflow.app/creators/c1/file.jpg"
    );
    // No debe haber tocado el FS
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("does NOT redirect when thumb=1, even if publicUrl exists (thumbnails live in FS)", async () => {
    mockFindFirst.mockResolvedValue({
      ...SAMPLE_ITEM,
      publicUrl: "https://cdn.fanflow.app/creators/c1/file.jpg",
    });
    mockReadFile.mockResolvedValue(Buffer.from("thumb-bytes") as never);
    const res = await GET(
      makeReq("http://localhost/api/media/abc?thumb=1"),
      makeParams("abc")
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    const call = (mockReadFile.mock.calls[0][0] as string).replace(/\\/g, "/");
    expect(call.endsWith("creator-1/file_thumb.webp")).toBe(true);
  });

  it("falls back to FS for the original when publicUrl is null", async () => {
    mockFindFirst.mockResolvedValue({ ...SAMPLE_ITEM, publicUrl: null });
    mockReadFile.mockResolvedValue(Buffer.from("original-bytes") as never);
    const res = await GET(
      makeReq("http://localhost/api/media/abc"),
      makeParams("abc")
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const call = (mockReadFile.mock.calls[0][0] as string).replace(/\\/g, "/");
    expect(call.endsWith("creator-1/file.jpg")).toBe(true);
  });

  it("returns 404 when the FS file cannot be read", async () => {
    mockFindFirst.mockResolvedValue({ ...SAMPLE_ITEM, publicUrl: null });
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const res = await GET(
      makeReq("http://localhost/api/media/abc"),
      makeParams("abc")
    );
    expect(res.status).toBe(404);
  });
});
