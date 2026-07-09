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

vi.mock("@/server/services/r2-storage", () => ({
  isR2Configured: vi.fn().mockReturnValue(true),
  getSignedUrlForKey: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { db } from "@/server/db";
import { readFile } from "fs/promises";
import { GET } from "@/app/api/media/[id]/route";
import {
  isR2Configured,
  getSignedUrlForKey,
} from "@/server/services/r2-storage";

const mockSession = vi.mocked(getServerSession);
const mockFindFirst = vi.mocked(db.query.mediaItems.findFirst);
const mockReadFile = vi.mocked(readFile);
const mockIsR2 = vi.mocked(isR2Configured);
const mockSigned = vi.mocked(getSignedUrlForKey);

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
  isPrivate: false,
  r2Key: null as string | null,
  mimeType: "image/jpeg",
};

describe("GET /api/media/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: "creator-1" } } as never);
    mockIsR2.mockReturnValue(true);
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
    } as never);
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
    } as never);
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
    mockFindFirst.mockResolvedValue({ ...SAMPLE_ITEM, publicUrl: null } as never);
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

  it("isPrivate item: redirects (302) to a freshly signed URL (no public URL exposed)", async () => {
    mockFindFirst.mockResolvedValue({
      ...SAMPLE_ITEM,
      isPrivate: true,
      r2Key: "creators/c1/secret.mp4",
      publicUrl: null,
    } as never);
    mockSigned.mockResolvedValue("https://signed.r2/abc?exp=3600");

    const res = await GET(
      makeReq("http://localhost/api/media/abc"),
      makeParams("abc")
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://signed.r2/abc?exp=3600");
    expect(mockSigned).toHaveBeenCalledWith({
      key: "creators/c1/secret.mp4",
      expiresInSec: 3600,
    });
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("isPrivate but R2 not configured: falls back to FS instead of crashing", async () => {
    mockIsR2.mockReturnValue(false);
    mockFindFirst.mockResolvedValue({
      ...SAMPLE_ITEM,
      isPrivate: true,
      r2Key: "creators/c1/secret.mp4",
      publicUrl: null,
    } as never);
    mockReadFile.mockResolvedValue(Buffer.from("local-bytes") as never);

    const res = await GET(
      makeReq("http://localhost/api/media/abc"),
      makeParams("abc")
    );
    expect(res.status).toBe(200);
    expect(mockSigned).not.toHaveBeenCalled();
    expect(mockReadFile).toHaveBeenCalled();
  });

  it("isPrivate with signing failure: falls back to FS", async () => {
    mockFindFirst.mockResolvedValue({
      ...SAMPLE_ITEM,
      isPrivate: true,
      r2Key: "creators/c1/secret.mp4",
      publicUrl: null,
    } as never);
    mockSigned.mockRejectedValue(new Error("presigner down"));
    mockReadFile.mockResolvedValue(Buffer.from("local") as never);

    const res = await GET(
      makeReq("http://localhost/api/media/abc"),
      makeParams("abc")
    );
    expect(res.status).toBe(200);
  });

  it("returns 404 when the FS file cannot be read", async () => {
    mockFindFirst.mockResolvedValue({ ...SAMPLE_ITEM, publicUrl: null } as never);
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const res = await GET(
      makeReq("http://localhost/api/media/abc"),
      makeParams("abc")
    );
    expect(res.status).toBe(404);
  });
});
