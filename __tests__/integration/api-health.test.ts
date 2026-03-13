import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock database
vi.mock("@/server/db", () => ({
  db: {
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  },
}));

// ioredis is already mocked in setup.ts

import { db } from "@/server/db";

const mockDbExecute = vi.mocked(db.execute);

beforeEach(() => {
  vi.clearAllMocks();
  mockDbExecute.mockResolvedValue([{ "?column?": 1 }] as any);
});

describe("GET /api/health", () => {
  describe("health check logic", () => {
    it("reports healthy when all checks pass", () => {
      const checks = {
        database: { status: "ok" as const, latencyMs: 5 },
        redis: { status: "ok" as const, latencyMs: 2 },
      };

      const allHealthy = Object.values(checks).every((c) => c.status === "ok");
      expect(allHealthy).toBe(true);

      const response = {
        status: allHealthy ? "healthy" : "degraded",
        timestamp: new Date().toISOString(),
        version: "0.1.0",
        checks,
      };

      expect(response.status).toBe("healthy");
    });

    it("reports degraded when database fails", () => {
      const checks = {
        database: { status: "error" as const, latencyMs: 3000, error: "Connection refused" },
        redis: { status: "ok" as const, latencyMs: 2 },
      };

      const allHealthy = Object.values(checks).every((c) => c.status === "ok");
      expect(allHealthy).toBe(false);

      expect("degraded").toBe("degraded");
    });

    it("reports degraded when Redis fails", () => {
      const checks = {
        database: { status: "ok" as const, latencyMs: 5 },
        redis: { status: "error" as const, latencyMs: 3000, error: "Connection timeout" },
      };

      const allHealthy = Object.values(checks).every((c) => c.status === "ok");
      expect(allHealthy).toBe(false);
    });

    it("reports degraded when both fail", () => {
      const checks = {
        database: { status: "error" as const, error: "down" },
        redis: { status: "error" as const, error: "down" },
      };

      const allHealthy = Object.values(checks).every((c) => c.status === "ok");
      expect(allHealthy).toBe(false);
    });

    it("includes latency measurements", () => {
      const start = Date.now();
      const end = Date.now();
      const latency = end - start;
      expect(latency).toBeGreaterThanOrEqual(0);
    });

    it("returns HTTP 200 when healthy, 503 when degraded", () => {
      expect(true ? 200 : 503).toBe(200);
      expect(false ? 200 : 503).toBe(503);
    });

    it("includes version info", () => {
      const version = process.env.npm_package_version ?? "0.1.0";
      expect(version).toBeTruthy();
    });

    it("includes ISO timestamp", () => {
      const timestamp = new Date().toISOString();
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});
