import { describe, it, expect } from "vitest";
import { generateRawKey, hashKey } from "@/server/services/api-keys";

describe("API Keys", () => {
  describe("generateRawKey", () => {
    it("starts with ff_live_ prefix", () => {
      const key = generateRawKey();
      expect(key.startsWith("ff_live_")).toBe(true);
    });

    it("has correct length (prefix + 32 hex chars)", () => {
      const key = generateRawKey();
      // "ff_live_" = 8 chars, 16 random bytes = 32 hex chars
      expect(key.length).toBe(8 + 32);
    });

    it("generates unique keys", () => {
      const keys = new Set(Array.from({ length: 10 }, () => generateRawKey()));
      expect(keys.size).toBe(10);
    });

    it("only contains valid characters", () => {
      const key = generateRawKey();
      expect(key).toMatch(/^ff_live_[0-9a-f]{32}$/);
    });
  });

  describe("hashKey", () => {
    it("returns a 64-char hex SHA-256 hash", () => {
      const hash = hashKey("ff_live_test123");
      expect(hash.length).toBe(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("same input produces same hash", () => {
      const key = "ff_live_abc123def456";
      expect(hashKey(key)).toBe(hashKey(key));
    });

    it("different inputs produce different hashes", () => {
      const hash1 = hashKey("ff_live_key1");
      const hash2 = hashKey("ff_live_key2");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("key prefix extraction", () => {
    it("prefix is first 16 chars of key", () => {
      const key = generateRawKey();
      const prefix = key.slice(0, 16); // "ff_live_" + 8 hex chars
      expect(prefix.startsWith("ff_live_")).toBe(true);
      expect(prefix.length).toBe(16);
    });
  });
});
