import { describe, it, expect } from "vitest";
import { encrypt, decrypt, isEncrypted } from "@/lib/crypto";

describe("crypto", () => {
  describe("encrypt", () => {
    it("encrypts a plaintext string", () => {
      const result = encrypt("my-secret-api-key");
      expect(result).toBeDefined();
      expect(result.split(":")).toHaveLength(3);
    });

    it("produces different ciphertexts for the same input (random IV)", () => {
      const a = encrypt("same-key");
      const b = encrypt("same-key");
      expect(a).not.toBe(b);
    });

    it("encrypts empty string", () => {
      const result = encrypt("");
      expect(result.split(":")).toHaveLength(3);
    });

    it("encrypts long strings", () => {
      const longKey = "sk-ant-" + "a".repeat(500);
      const result = encrypt(longKey);
      expect(result.split(":")).toHaveLength(3);
    });

    it("encrypts strings with special characters", () => {
      const special = "key-with-特殊-chars-!@#$%^&*()";
      const result = encrypt(special);
      const decrypted = decrypt(result);
      expect(decrypted).toBe(special);
    });
  });

  describe("decrypt", () => {
    it("decrypts an encrypted string", () => {
      const original = "sk-ant-api03-test-key";
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it("returns plaintext if not encrypted (backward compatibility)", () => {
      const plaintext = "sk-ant-old-key-no-encryption";
      expect(decrypt(plaintext)).toBe(plaintext);
    });

    it("returns as-is if format has wrong number of parts", () => {
      expect(decrypt("only:two")).toBe("only:two");
      expect(decrypt("a:b:c:d")).toBe("a:b:c:d");
    });

    it("returns as-is if IV or authTag have wrong lengths", () => {
      // IV too short (not 32 hex chars)
      const bad = "short:short:ciphertext";
      expect(decrypt(bad)).toBe(bad);
    });

    it("roundtrips unicode content", () => {
      const unicode = "clave-con-ñ-y-ü-y-emoji-🚀";
      expect(decrypt(encrypt(unicode))).toBe(unicode);
    });
  });

  describe("isEncrypted", () => {
    it("returns true for encrypted values", () => {
      const encrypted = encrypt("test");
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it("returns false for plaintext", () => {
      expect(isEncrypted("sk-ant-plaintext-key")).toBe(false);
    });

    it("returns false for wrong part count", () => {
      expect(isEncrypted("only-one-part")).toBe(false);
      expect(isEncrypted("a:b")).toBe(false);
    });

    it("returns false for wrong IV/authTag lengths", () => {
      expect(isEncrypted("short:short:cipher")).toBe(false);
    });
  });
});
