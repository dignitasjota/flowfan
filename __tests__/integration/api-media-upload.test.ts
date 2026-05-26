import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  authOptions: {},
}));

vi.mock("@/server/db", () => ({
  db: {
    insert: vi.fn(),
  },
}));

vi.mock("@/server/services/usage-limits", () => ({
  checkMediaFileLimit: vi.fn().mockResolvedValue(undefined),
  checkMediaStorageLimit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/logger", () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("sharp", () => {
  const pipeline = {
    metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("optimized")),
    toFile: vi.fn().mockResolvedValue(undefined),
  };
  const sharpFn = vi.fn(() => pipeline);
  return { default: sharpFn };
});

vi.mock("@/server/services/r2-storage", () => ({
  isR2Configured: vi.fn().mockReturnValue(false),
  buildR2Key: vi.fn().mockReturnValue("creators/c1/2026-01-01/abc.jpg"),
  uploadBuffer: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { db } from "@/server/db";
import {
  isR2Configured,
  uploadBuffer,
} from "@/server/services/r2-storage";
import { POST } from "@/app/api/media/upload/route";

const mockSession = vi.mocked(getServerSession);
const mockIsR2 = vi.mocked(isR2Configured);
const mockUploadR2 = vi.mocked(uploadBuffer);
const mockInsert = vi.mocked(db.insert);

function buildInsertChain() {
  return {
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([
        {
          id: "media-1",
          publicUrl: null,
          storagePath: "creator-1/file.jpg",
        },
      ]),
    }),
  };
}

function makeRequest(body: FormData): Request {
  return new Request("http://localhost/api/media/upload", {
    method: "POST",
    body,
  });
}

function makeFile(
  bytes: Uint8Array,
  filename: string,
  type: string
): File {
  return new File([bytes], filename, { type });
}

describe("POST /api/media/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: "creator-1" } } as never);
    mockIsR2.mockReturnValue(false);
    mockInsert.mockReturnValue(buildInsertChain() as never);
  });

  it("returns 401 when there is no session", async () => {
    mockSession.mockResolvedValue(null);
    const form = new FormData();
    const res = await POST(makeRequest(form));
    expect(res.status).toBe(401);
  });

  it("returns 400 when no file is provided", async () => {
    const form = new FormData();
    const res = await POST(makeRequest(form));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/archivo/i);
  });

  it("returns 400 when MIME type is not allowed", async () => {
    const form = new FormData();
    form.set(
      "file",
      makeFile(new Uint8Array([1, 2, 3]), "doc.pdf", "application/pdf")
    );
    const res = await POST(makeRequest(form));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no permitido/i);
  });

  it("returns 400 when file exceeds the 50MB limit", async () => {
    // `Object.defineProperty(file, "size")` no sobrevive a la reserialización
    // que hace `request.formData()`. Stub el método directamente con un File
    // cuyo `size` reporta > 50MB sin alocar la memoria.
    const fakeFile = new File([new Uint8Array(10)], "big.jpg", {
      type: "image/jpeg",
    });
    Object.defineProperty(fakeFile, "size", { value: 60 * 1024 * 1024 });
    const req = new Request("http://localhost/api/media/upload", {
      method: "POST",
    });
    (req as unknown as { formData: () => Promise<FormData> }).formData =
      async () => {
        const fd = new FormData();
        fd.set("file", fakeFile);
        return fd;
      };
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/50MB/);
  });

  it("uploads to R2 and persists r2Key + publicUrl when R2 is configured", async () => {
    mockIsR2.mockReturnValue(true);
    mockUploadR2.mockResolvedValue({
      key: "creators/c1/2026-01-01/abc.jpg",
      publicUrl: "https://cdn.fanflow.app/creators/c1/2026-01-01/abc.jpg",
      size: 9,
      mimeType: "image/jpeg",
    });
    const insertChain = buildInsertChain();
    mockInsert.mockReturnValue(insertChain as never);

    const form = new FormData();
    form.set(
      "file",
      makeFile(new Uint8Array([1, 2, 3, 4]), "photo.jpg", "image/jpeg")
    );
    const res = await POST(makeRequest(form));
    expect(res.status).toBe(200);
    expect(mockUploadR2).toHaveBeenCalledTimes(1);
    const inserted = (insertChain.values as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect(inserted.r2Key).toBe("creators/c1/2026-01-01/abc.jpg");
    expect(inserted.publicUrl).toBe(
      "https://cdn.fanflow.app/creators/c1/2026-01-01/abc.jpg"
    );
  });

  it("does not call R2 when not configured (FS fallback)", async () => {
    mockIsR2.mockReturnValue(false);
    const insertChain = buildInsertChain();
    mockInsert.mockReturnValue(insertChain as never);

    const form = new FormData();
    form.set(
      "file",
      makeFile(new Uint8Array([1, 2, 3, 4]), "photo.jpg", "image/jpeg")
    );
    const res = await POST(makeRequest(form));
    expect(res.status).toBe(200);
    expect(mockUploadR2).not.toHaveBeenCalled();
    const inserted = (insertChain.values as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect(inserted.r2Key).toBeNull();
    expect(inserted.publicUrl).toBeNull();
  });

  it("uploads videos to R2 when configured (no sharp optimization on the way)", async () => {
    mockIsR2.mockReturnValue(true);
    mockUploadR2.mockResolvedValue({
      key: "creators/c1/2026-01-01/abc.mp4",
      publicUrl: "https://cdn.fanflow.app/creators/c1/2026-01-01/abc.mp4",
      size: 4,
      mimeType: "video/mp4",
    });
    const insertChain = buildInsertChain();
    mockInsert.mockReturnValue(insertChain as never);

    const form = new FormData();
    form.set(
      "file",
      makeFile(new Uint8Array([1, 2, 3, 4]), "clip.mp4", "video/mp4")
    );
    const res = await POST(makeRequest(form));
    expect(res.status).toBe(200);
    expect(mockUploadR2).toHaveBeenCalledTimes(1);
    const inserted = (insertChain.values as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect(inserted.r2Key).toBe("creators/c1/2026-01-01/abc.mp4");
    expect(inserted.publicUrl).toBe(
      "https://cdn.fanflow.app/creators/c1/2026-01-01/abc.mp4"
    );
  });

  it("falls back to FS when R2 upload throws", async () => {
    mockIsR2.mockReturnValue(true);
    mockUploadR2.mockRejectedValue(new Error("R2 5xx"));
    const insertChain = buildInsertChain();
    mockInsert.mockReturnValue(insertChain as never);

    const form = new FormData();
    form.set(
      "file",
      makeFile(new Uint8Array([1, 2, 3, 4]), "photo.jpg", "image/jpeg")
    );
    const res = await POST(makeRequest(form));
    expect(res.status).toBe(200);
    const inserted = (insertChain.values as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect(inserted.r2Key).toBeNull();
    expect(inserted.publicUrl).toBeNull();
  });
});
