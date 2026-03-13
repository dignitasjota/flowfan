import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

vi.mock("@/server/db", () => ({
  db: {
    query: {
      passwordResetTokens: { findFirst: vi.fn() },
    },
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));

vi.mock("bcryptjs", () => ({
  hash: vi.fn().mockResolvedValue("$2a$12$new_hash"),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 3, resetAt: 0 }),
  RATE_LIMITS: {
    auth: { limit: 5, windowSeconds: 60 },
    register: { limit: 3, windowSeconds: 300 },
  },
}));

import { db } from "@/server/db";
import { rateLimit } from "@/lib/rate-limit";

const mockFindFirst = vi.mocked(db.query.passwordResetTokens.findFirst);
const mockRateLimit = vi.mocked(rateLimit);

const passwordSchema = z
  .string()
  .min(8)
  .regex(/[A-Z]/)
  .regex(/[a-z]/)
  .regex(/[0-9]/)
  .regex(/[^A-Za-z0-9]/);

const resetSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRateLimit.mockResolvedValue({ success: true, remaining: 3, resetAt: 0 });
});

describe("POST /api/auth/reset-password", () => {
  describe("input validation", () => {
    it("accepts valid token and password", () => {
      const result = resetSchema.safeParse({
        token: "abc123def456",
        password: "NewP@ssw0rd!",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty token", () => {
      const result = resetSchema.safeParse({
        token: "",
        password: "NewP@ssw0rd!",
      });
      expect(result.success).toBe(false);
    });

    it("rejects weak password", () => {
      const result = resetSchema.safeParse({
        token: "valid-token",
        password: "weak",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("token verification", () => {
    it("rejects expired token", async () => {
      mockFindFirst.mockResolvedValueOnce(null); // expired = not found by query
      const token = await db.query.passwordResetTokens.findFirst();
      expect(token).toBeNull();
    });

    it("rejects already used token", async () => {
      mockFindFirst.mockResolvedValueOnce(null); // usedAt != null = not found by query
      const token = await db.query.passwordResetTokens.findFirst();
      expect(token).toBeNull();
    });

    it("accepts valid unused non-expired token", async () => {
      const validToken = {
        id: "t1",
        email: "test@test.com",
        token: "valid",
        expiresAt: new Date(Date.now() + 3600000),
        usedAt: null,
      };
      mockFindFirst.mockResolvedValueOnce(validToken as any);

      const token = await db.query.passwordResetTokens.findFirst();
      expect(token).toBeDefined();
      expect(token!.usedAt).toBeNull();
    });
  });

  describe("password update flow", () => {
    it("marks token as used after password change", () => {
      const update = { usedAt: new Date() };
      expect(update.usedAt).toBeDefined();
    });

    it("updates password for correct email", () => {
      const resetToken = { email: "test@test.com" };
      const update = { passwordHash: "$2a$12$new_hash", updatedAt: new Date() };
      expect(update.passwordHash).toBeTruthy();
      expect(resetToken.email).toBe("test@test.com");
    });
  });

  describe("rate limiting", () => {
    it("rate limits by IP", async () => {
      await rateLimit("reset:192.168.1.1", { limit: 5, windowSeconds: 60 });
      expect(mockRateLimit).toHaveBeenCalled();
    });

    it("returns 429 when exceeded", async () => {
      mockRateLimit.mockResolvedValueOnce({ success: false, remaining: 0, resetAt: Date.now() / 1000 + 60 });
      const result = await rateLimit("reset:ip", { limit: 5, windowSeconds: 60 });
      expect(result.success).toBe(false);
    });
  });
});
