import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * El módulo `r2-storage` cachea internamente el cliente S3 y lee env vars en
 * `getClient` / `getBucket` / `getPublicBase`. Para aislar cada test:
 *  - mockeamos `@aws-sdk/client-s3` con `vi.mock` (factory) y capturamos los
 *    comandos enviados a través de un spy compartido.
 *  - usamos `vi.resetModules()` + `await import()` dinámico para forzar una
 *    instancia fresca tras mutar `process.env`.
 */

const sendSpy = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommand {
    readonly type = "Put";
    constructor(public input: Record<string, unknown>) {}
  }
  class DeleteObjectCommand {
    readonly type = "Delete";
    constructor(public input: Record<string, unknown>) {}
  }
  class GetObjectCommand {
    readonly type = "Get";
    constructor(public input: Record<string, unknown>) {}
  }
  class S3Client {
    constructor(public config: Record<string, unknown>) {}
    send = sendSpy;
  }
  return { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(
    async (_client, command: { input: { Bucket: string; Key: string } }, opts: { expiresIn: number }) =>
      `https://signed.example/${command.input.Bucket}/${command.input.Key}?exp=${opts.expiresIn}`
  ),
}));

type R2Module = typeof import("@/server/services/r2-storage");

async function loadR2(env: Partial<Record<string, string>> = {}): Promise<R2Module> {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import("@/server/services/r2-storage");
}

const FULL_ENV: Record<string, string> = {
  R2_ENDPOINT: "https://acc.r2.cloudflarestorage.com",
  R2_BUCKET: "fanflow-media",
  R2_ACCESS_KEY_ID: "AKIAFAKE",
  R2_SECRET_ACCESS_KEY: "supersecret",
  R2_PUBLIC_URL: "https://cdn.fanflow.app",
};

describe("r2-storage", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    sendSpy.mockReset();
    sendSpy.mockResolvedValue({});
    // Limpia todas las R2_* para empezar de cero
    for (const k of Object.keys(FULL_ENV)) delete process.env[k];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("isR2Configured", () => {
    it("returns false when no env vars are set", async () => {
      const mod = await loadR2({});
      expect(mod.isR2Configured()).toBe(false);
    });

    it("returns false when only some vars are set", async () => {
      const mod = await loadR2({
        R2_ENDPOINT: FULL_ENV.R2_ENDPOINT,
        R2_BUCKET: FULL_ENV.R2_BUCKET,
      });
      expect(mod.isR2Configured()).toBe(false);
    });

    it("returns true when all five vars are set", async () => {
      const mod = await loadR2(FULL_ENV);
      expect(mod.isR2Configured()).toBe(true);
    });
  });

  describe("buildR2Key", () => {
    it("prefers extension from original name over mime type", async () => {
      const mod = await loadR2(FULL_ENV);
      const key = mod.buildR2Key({
        creatorId: "creator-123",
        originalName: "vacation.JPEG",
        mimeType: "image/png", // distinto a propósito; debe ganar el del nombre
      });
      expect(key.endsWith(".jpeg")).toBe(true);
    });

    it("falls back to mime extension when name has none", async () => {
      const mod = await loadR2(FULL_ENV);
      const key = mod.buildR2Key({
        creatorId: "creator-123",
        originalName: "noext",
        mimeType: "image/webp",
      });
      expect(key.endsWith(".webp")).toBe(true);
    });

    it("falls back to 'bin' when nothing is parseable", async () => {
      const mod = await loadR2(FULL_ENV);
      const key = mod.buildR2Key({
        creatorId: "creator-123",
        originalName: "noext",
        mimeType: "garbage",
      });
      // mimetype "garbage" no tiene "/" → mod actual lo trata como undefined
      // y usa "bin"
      expect(key.endsWith(".bin")).toBe(true);
    });

    it("namespaces by creator and uses today's date + random hex", async () => {
      const mod = await loadR2(FULL_ENV);
      const key = mod.buildR2Key({
        creatorId: "creator-xyz",
        originalName: "photo.png",
        mimeType: "image/png",
      });
      const today = new Date().toISOString().slice(0, 10);
      // creators/{id}/{YYYY-MM-DD}/{24 hex}.png — 12 bytes => 24 hex chars
      const re = new RegExp(`^creators/creator-xyz/${today}/[0-9a-f]{24}\\.png$`);
      expect(key).toMatch(re);
    });

    it("produces different keys on consecutive calls (random component)", async () => {
      const mod = await loadR2(FULL_ENV);
      const a = mod.buildR2Key({
        creatorId: "c",
        originalName: "a.png",
        mimeType: "image/png",
      });
      const b = mod.buildR2Key({
        creatorId: "c",
        originalName: "a.png",
        mimeType: "image/png",
      });
      expect(a).not.toBe(b);
    });
  });

  describe("uploadBuffer", () => {
    it("sends PutObjectCommand with the expected bucket/key/body/content-type", async () => {
      const mod = await loadR2(FULL_ENV);
      const body = Buffer.from([1, 2, 3, 4]);
      const result = await mod.uploadBuffer({
        key: "creators/c1/2026-01-01/abc.jpg",
        body,
        mimeType: "image/jpeg",
      });
      expect(sendSpy).toHaveBeenCalledTimes(1);
      const cmd = sendSpy.mock.calls[0][0] as { type: string; input: Record<string, unknown> };
      expect(cmd.type).toBe("Put");
      expect(cmd.input.Bucket).toBe(FULL_ENV.R2_BUCKET);
      expect(cmd.input.Key).toBe("creators/c1/2026-01-01/abc.jpg");
      expect(cmd.input.Body).toBe(body);
      expect(cmd.input.ContentType).toBe("image/jpeg");
      expect(result).toEqual({
        key: "creators/c1/2026-01-01/abc.jpg",
        publicUrl: "https://cdn.fanflow.app/creators/c1/2026-01-01/abc.jpg",
        size: 4,
        mimeType: "image/jpeg",
      });
    });

    it("uses immutable cache-control when immutable=true", async () => {
      const mod = await loadR2(FULL_ENV);
      await mod.uploadBuffer({
        key: "k",
        body: Buffer.from("x"),
        mimeType: "image/png",
        immutable: true,
      });
      const cmd = sendSpy.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(cmd.input.CacheControl).toBe("public, max-age=31536000, immutable");
    });

    it("uses 1-hour cache-control when immutable is omitted/false", async () => {
      const mod = await loadR2(FULL_ENV);
      await mod.uploadBuffer({
        key: "k",
        body: Buffer.from("x"),
        mimeType: "image/png",
      });
      const cmd = sendSpy.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(cmd.input.CacheControl).toBe("public, max-age=3600");
    });

    it("strips trailing slash from R2_PUBLIC_URL when building publicUrl", async () => {
      const mod = await loadR2({
        ...FULL_ENV,
        R2_PUBLIC_URL: "https://cdn.fanflow.app/",
      });
      const result = await mod.uploadBuffer({
        key: "creators/c1/x.png",
        body: Buffer.from("x"),
        mimeType: "image/png",
      });
      expect(result.publicUrl).toBe("https://cdn.fanflow.app/creators/c1/x.png");
    });

    it("throws when R2 is not configured", async () => {
      // El orden actual valida primero el bucket (en `getBucket`) — el test
      // sólo verifica que el upload no se completa silenciosamente.
      const mod = await loadR2({});
      await expect(
        mod.uploadBuffer({
          key: "k",
          body: Buffer.from("x"),
          mimeType: "image/png",
        })
      ).rejects.toThrow(/R2_BUCKET not configured|R2 storage is not configured/);
    });
  });

  describe("deleteObject", () => {
    it("sends DeleteObjectCommand with bucket+key", async () => {
      const mod = await loadR2(FULL_ENV);
      await mod.deleteObject("creators/c1/foo.jpg");
      expect(sendSpy).toHaveBeenCalledTimes(1);
      const cmd = sendSpy.mock.calls[0][0] as { type: string; input: Record<string, unknown> };
      expect(cmd.type).toBe("Delete");
      expect(cmd.input.Bucket).toBe(FULL_ENV.R2_BUCKET);
      expect(cmd.input.Key).toBe("creators/c1/foo.jpg");
    });
  });

  describe("getSignedUrlForKey", () => {
    it("delegates to s3-request-presigner with bucket+key and a 1h default", async () => {
      const mod = await loadR2(FULL_ENV);
      const url = await mod.getSignedUrlForKey({ key: "creators/c1/x.png" });
      expect(url).toBe(
        `https://signed.example/${FULL_ENV.R2_BUCKET}/creators/c1/x.png?exp=3600`
      );
    });

    it("honors a custom expiresInSec", async () => {
      const mod = await loadR2(FULL_ENV);
      const url = await mod.getSignedUrlForKey({
        key: "k",
        expiresInSec: 60,
      });
      expect(url).toContain("exp=60");
    });
  });

  describe("publicUrlFor", () => {
    it("concatenates base and key", async () => {
      const mod = await loadR2(FULL_ENV);
      expect(mod.publicUrlFor("creators/c1/x.png")).toBe(
        "https://cdn.fanflow.app/creators/c1/x.png"
      );
    });

    it("strips trailing slash from R2_PUBLIC_URL", async () => {
      const mod = await loadR2({
        ...FULL_ENV,
        R2_PUBLIC_URL: "https://cdn.fanflow.app/",
      });
      expect(mod.publicUrlFor("k.png")).toBe("https://cdn.fanflow.app/k.png");
    });
  });
});
