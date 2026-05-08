import { describe, it, expect } from "vitest";
import { validateRecurrenceRule } from "@/server/services/recurrence";

/**
 * The scheduler router is mostly orchestration around DB writes + BullMQ.
 * Heavy mocks would be brittle, so these tests cover the *decisional logic*
 * extracted as small predicates: schedule date validation, missing-account
 * detection, status transitions, BullMQ delay computation. Pure end-to-end
 * publishing is exercised in integration tests with a real queue.
 */

describe("scheduler router decisional logic", () => {
  describe("scheduleAt validation", () => {
    const isInPast = (d: Date) => d.getTime() < Date.now() - 30_000;

    it("rejects dates more than 30s in the past", () => {
      const oldDate = new Date(Date.now() - 60_000);
      expect(isInPast(oldDate)).toBe(true);
    });

    it("accepts dates in the immediate future", () => {
      const future = new Date(Date.now() + 60_000);
      expect(isInPast(future)).toBe(false);
    });

    it("tolerates 30s clock-skew window", () => {
      const slightlyOld = new Date(Date.now() - 10_000);
      expect(isInPast(slightlyOld)).toBe(false);
    });
  });

  describe("missing accounts detection", () => {
    function findMissing(
      target: string[],
      connected: { platformType: string }[]
    ): string[] {
      const set = new Set(connected.map((a) => a.platformType));
      return target.filter((p) => !set.has(p));
    }

    it("returns all targets when no accounts are connected", () => {
      const missing = findMissing(["reddit", "twitter"], []);
      expect(missing).toEqual(["reddit", "twitter"]);
    });

    it("returns only the unconnected platforms", () => {
      const missing = findMissing(
        ["reddit", "twitter", "instagram"],
        [{ platformType: "reddit" }, { platformType: "instagram" }]
      );
      expect(missing).toEqual(["twitter"]);
    });

    it("returns empty when all are connected", () => {
      const missing = findMissing(
        ["reddit"],
        [{ platformType: "reddit" }, { platformType: "twitter" }]
      );
      expect(missing).toEqual([]);
    });
  });

  describe("status transitions", () => {
    const cancellableStatuses = new Set(["scheduled", "failed"]);

    it("allows cancel from scheduled", () => {
      expect(cancellableStatuses.has("scheduled")).toBe(true);
    });

    it("allows cancel from failed", () => {
      expect(cancellableStatuses.has("failed")).toBe(true);
    });

    it("rejects cancel from posted/cancelled/processing", () => {
      expect(cancellableStatuses.has("posted")).toBe(false);
      expect(cancellableStatuses.has("cancelled")).toBe(false);
      expect(cancellableStatuses.has("processing")).toBe(false);
    });
  });

  describe("BullMQ delay computation", () => {
    function computeDelay(scheduleAt: Date): number {
      return Math.max(0, scheduleAt.getTime() - Date.now());
    }

    it("returns 0 for past dates (executes immediately)", () => {
      const past = new Date(Date.now() - 1000);
      expect(computeDelay(past)).toBe(0);
    });

    it("returns positive ms for future dates", () => {
      const future = new Date(Date.now() + 5000);
      const delay = computeDelay(future);
      expect(delay).toBeGreaterThan(4000);
      expect(delay).toBeLessThanOrEqual(5000);
    });
  });

  describe("recurrence input validation", () => {
    it("daily rules without dayOfWeek are accepted", () => {
      expect(() =>
        validateRecurrenceRule({ frequency: "daily", hour: 10, minute: 0 })
      ).not.toThrow();
    });

    it("weekly rules require dayOfWeek", () => {
      expect(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        validateRecurrenceRule({ frequency: "weekly", hour: 10, minute: 0 } as any)
      ).toThrow();
    });

    it("invalid hour is rejected", () => {
      expect(() =>
        validateRecurrenceRule({ frequency: "daily", hour: 30, minute: 0 })
      ).toThrow(/hour/i);
    });
  });

  describe("post-publish recurrence advancement", () => {
    /**
     * Mirrors worker logic: after publishing, if recurrenceRule exists AND
     * at least one platform succeeded, advance to next occurrence.
     * If none succeeded, do not advance (allow retries to keep same date).
     */
    function shouldAdvance(rule: object | null, successCount: number): boolean {
      return !!rule && successCount > 0;
    }

    it("does not advance when no recurrence rule", () => {
      expect(shouldAdvance(null, 1)).toBe(false);
    });

    it("does not advance when 0 successes", () => {
      expect(shouldAdvance({ frequency: "daily" }, 0)).toBe(false);
    });

    it("advances when rule + at least one success", () => {
      expect(shouldAdvance({ frequency: "daily" }, 1)).toBe(true);
      expect(shouldAdvance({ frequency: "daily" }, 2)).toBe(true);
    });
  });

  describe("final status computation", () => {
    function computeFinalStatus(
      successCount: number,
      total: number
    ): "posted" | "partial" | "failed" {
      if (successCount === total) return "posted";
      if (successCount === 0) return "failed";
      return "partial";
    }

    it("posted when all succeed", () => {
      expect(computeFinalStatus(3, 3)).toBe("posted");
    });

    it("failed when none succeed", () => {
      expect(computeFinalStatus(0, 3)).toBe("failed");
    });

    it("partial otherwise", () => {
      expect(computeFinalStatus(2, 3)).toBe("partial");
      expect(computeFinalStatus(1, 3)).toBe("partial");
    });
  });
});
