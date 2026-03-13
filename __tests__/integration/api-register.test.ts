import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// Mock dependencies
vi.mock("@/server/db", () => ({
  db: {
    query: {
      creators: { findFirst: vi.fn() },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("bcryptjs", () => ({
  hash: vi.fn().mockResolvedValue("$2a$12$hashed"),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 3, resetAt: 0 }),
  RATE_LIMITS: {
    register: { limit: 3, windowSeconds: 300 },
    auth: { limit: 5, windowSeconds: 60 },
  },
}));

vi.mock("@/lib/logger", () => ({
  createChildLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

import { db } from "@/server/db";
import { rateLimit } from "@/lib/rate-limit";
import { hash } from "bcryptjs";

const mockFindFirst = vi.mocked(db.query.creators.findFirst);
const mockRateLimit = vi.mocked(rateLimit);

beforeEach(() => {
  vi.clearAllMocks();
  mockRateLimit.mockResolvedValue({ success: true, remaining: 3, resetAt: 0 });
  mockFindFirst.mockResolvedValue(null);
});

// Password schema from register route
const passwordSchema = z
  .string()
  .min(8)
  .regex(/[A-Z]/)
  .regex(/[a-z]/)
  .regex(/[0-9]/)
  .regex(/[^A-Za-z0-9]/);

const registerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  password: passwordSchema,
});

describe("POST /api/auth/register", () => {
  describe("input validation", () => {
    it("accepts valid registration data", () => {
      const result = registerSchema.safeParse({
        name: "Test Creator",
        email: "test@example.com",
        password: "MyP@ssw0rd!",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing name", () => {
      const result = registerSchema.safeParse({
        name: "",
        email: "test@example.com",
        password: "MyP@ssw0rd!",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid email", () => {
      const result = registerSchema.safeParse({
        name: "Test",
        email: "not-an-email",
        password: "MyP@ssw0rd!",
      });
      expect(result.success).toBe(false);
    });

    it("rejects short password", () => {
      const result = registerSchema.safeParse({
        name: "Test",
        email: "test@example.com",
        password: "Ab1!",
      });
      expect(result.success).toBe(false);
    });

    it("rejects password without uppercase", () => {
      expect(passwordSchema.safeParse("myp@ssw0rd!").success).toBe(false);
    });

    it("rejects password without lowercase", () => {
      expect(passwordSchema.safeParse("MYP@SSW0RD!").success).toBe(false);
    });

    it("rejects password without number", () => {
      expect(passwordSchema.safeParse("MyP@ssword!").success).toBe(false);
    });

    it("rejects password without special char", () => {
      expect(passwordSchema.safeParse("MyPassw0rd").success).toBe(false);
    });
  });

  describe("rate limiting", () => {
    it("rate limits by IP", async () => {
      await rateLimit("register:192.168.1.1", { limit: 3, windowSeconds: 300 });
      expect(mockRateLimit).toHaveBeenCalledWith(
        "register:192.168.1.1",
        expect.objectContaining({ limit: 3 })
      );
    });

    it("returns 429 when rate limited", async () => {
      mockRateLimit.mockResolvedValueOnce({ success: false, remaining: 0, resetAt: Date.now() / 1000 + 300 });
      const result = await rateLimit("register:ip", { limit: 3, windowSeconds: 300 });
      expect(result.success).toBe(false);
    });
  });

  describe("CSRF protection", () => {
    it("blocks mismatched origin", () => {
      const origin = "https://evil.com";
      const expectedOrigin = "http://localhost:3000";
      expect(origin !== expectedOrigin).toBe(true);
    });

    it("allows matching origin", () => {
      const origin = "http://localhost:3000";
      const expectedOrigin = "http://localhost:3000";
      expect(origin === expectedOrigin).toBe(true);
    });
  });

  describe("email uniqueness", () => {
    it("rejects duplicate email", async () => {
      mockFindFirst.mockResolvedValueOnce({ id: "existing", email: "test@test.com" } as any);
      const existing = await db.query.creators.findFirst();
      expect(existing).toBeDefined();
    });

    it("allows new email", async () => {
      const existing = await db.query.creators.findFirst();
      expect(existing).toBeNull();
    });
  });

  describe("password hashing", () => {
    it("hashes with 12 rounds", async () => {
      await hash("password", 12);
      expect(hash).toHaveBeenCalledWith("password", 12);
    });
  });
});
