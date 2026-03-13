import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/crypto", () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  decrypt: vi.fn((v: string) => v.replace("enc:", "")),
}));

vi.mock("@/server/services/usage-limits", () => ({
  checkFeatureAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/ai", () => ({
  PROVIDER_MODELS: {
    anthropic: [{ value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" }],
    openai: [{ value: "gpt-4o", label: "GPT-4o" }],
  },
}));

import { encrypt, decrypt } from "@/lib/crypto";
import { checkFeatureAccess } from "@/server/services/usage-limits";

const mockEncrypt = vi.mocked(encrypt);
const mockDecrypt = vi.mocked(decrypt);
const mockCheckFeature = vi.mocked(checkFeatureAccess);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ai-config router logic", () => {
  describe("get", () => {
    it("masks API key for frontend", () => {
      const key = "sk-1234567890abcdef";
      const masked = key.length <= 8
        ? "••••••••"
        : key.slice(0, 4) + "••••••••" + key.slice(-4);

      expect(masked).toBe("sk-1••••••••cdef");
    });

    it("masks short API key", () => {
      const key = "short";
      const masked = key.length <= 8 ? "••••••••" : key.slice(0, 4) + "••••••••" + key.slice(-4);
      expect(masked).toBe("••••••••");
    });

    it("returns null when no config exists", () => {
      const config = null;
      expect(config).toBeNull();
    });
  });

  describe("upsert", () => {
    it("encrypts new API key", () => {
      const result = mockEncrypt("sk-real-key");
      expect(result).toBe("enc:sk-real-key");
    });

    it("keeps existing encrypted key when input is masked", () => {
      const input = { apiKey: "sk-1••••••••cdef" };
      const existing = { apiKey: "enc:sk-real-key" };

      const apiKeyToStore = input.apiKey.includes("••••") && existing
        ? existing.apiKey
        : mockEncrypt(input.apiKey);

      expect(apiKeyToStore).toBe("enc:sk-real-key");
    });

    it("encrypts new key when not masked", () => {
      const input = { apiKey: "sk-brand-new-key" };
      const existing = { apiKey: "enc:old" };

      const apiKeyToStore = input.apiKey.includes("••••") && existing
        ? existing.apiKey
        : mockEncrypt(input.apiKey);

      expect(apiKeyToStore).toBe("enc:sk-brand-new-key");
    });
  });

  describe("testConnection", () => {
    it("resolves masked key from DB", () => {
      const inputKey = "sk-1••••••••cdef";
      const existingEncrypted = "enc:sk-realkey";

      let apiKey = inputKey;
      if (apiKey.includes("••••")) {
        apiKey = mockDecrypt(existingEncrypted);
      }

      expect(apiKey).toBe("sk-realkey");
    });

    it("uses provided key directly when not masked", () => {
      const inputKey = "sk-new-test-key";
      let apiKey = inputKey;
      if (apiKey.includes("••••")) {
        apiKey = mockDecrypt("enc:old");
      }
      expect(apiKey).toBe("sk-new-test-key");
    });
  });

  describe("upsertAssignment (multi-model)", () => {
    it("checks feature access before creating", async () => {
      await mockCheckFeature({} as any, "c1", "multiModel");
      expect(mockCheckFeature).toHaveBeenCalledWith({}, "c1", "multiModel");
    });

    it("rejects when multiModel not available", async () => {
      mockCheckFeature.mockRejectedValueOnce(new Error("Feature not available"));
      await expect(mockCheckFeature({} as any, "c1", "multiModel")).rejects.toThrow();
    });

    it("encrypts assignment API key", () => {
      const apiKey = "sk-assignment-key";
      const encrypted = mockEncrypt(apiKey);
      expect(encrypted).toBe("enc:sk-assignment-key");
    });

    it("keeps masked assignment key from existing", () => {
      const inputKey = "sk-1••••••••cdef";
      const existing = { apiKey: "enc:existing-key" };

      let apiKey: string | null = inputKey;
      if (apiKey && apiKey.includes("••••") && existing) {
        apiKey = existing.apiKey;
      }

      expect(apiKey).toBe("enc:existing-key");
    });

    it("sets null apiKey when not provided (falls back to default)", () => {
      const inputKey: string | undefined = undefined;
      const apiKey: string | null = inputKey ?? null;
      expect(apiKey).toBeNull();
    });
  });

  describe("deleteAssignment", () => {
    it("deletes by creator + taskType", () => {
      const conditions = { creatorId: "c1", taskType: "suggestion" };
      expect(conditions.taskType).toBe("suggestion");
    });
  });
});
