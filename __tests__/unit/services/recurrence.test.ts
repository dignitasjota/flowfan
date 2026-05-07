import { describe, it, expect } from "vitest";
import {
  computeNextOccurrence,
  validateRecurrenceRule,
  type RecurrenceRule,
} from "@/server/services/recurrence";

describe("recurrence", () => {
  describe("validateRecurrenceRule", () => {
    it("accepts a valid daily rule", () => {
      expect(() =>
        validateRecurrenceRule({ frequency: "daily", hour: 10, minute: 0 })
      ).not.toThrow();
    });

    it("rejects invalid hour", () => {
      expect(() =>
        validateRecurrenceRule({
          frequency: "daily",
          hour: 25,
          minute: 0,
        } as RecurrenceRule)
      ).toThrow(/hour/i);
    });

    it("rejects invalid minute", () => {
      expect(() =>
        validateRecurrenceRule({
          frequency: "daily",
          hour: 10,
          minute: 60,
        } as RecurrenceRule)
      ).toThrow(/minute/i);
    });

    it("requires dayOfWeek for weekly", () => {
      expect(() =>
        validateRecurrenceRule({
          frequency: "weekly",
          hour: 10,
          minute: 0,
        } as RecurrenceRule)
      ).toThrow(/dayOfWeek/i);
    });

    it("requires dayOfMonth for monthly", () => {
      expect(() =>
        validateRecurrenceRule({
          frequency: "monthly",
          hour: 10,
          minute: 0,
        } as RecurrenceRule)
      ).toThrow(/dayOfMonth/i);
    });

    it("rejects interval out of range", () => {
      expect(() =>
        validateRecurrenceRule({
          frequency: "daily",
          interval: 100,
          hour: 10,
          minute: 0,
        })
      ).toThrow(/interval/i);
    });
  });

  describe("computeNextOccurrence", () => {
    const from = new Date("2026-05-07T15:30:00.000Z");

    it("daily: advances at least one interval", () => {
      const next = computeNextOccurrence(
        { frequency: "daily", hour: 10, minute: 0 },
        from,
        0
      );
      expect(next).not.toBeNull();
      // Next day 10:00 in local TZ
      expect(next!.getDate()).toBe(from.getDate() + 1);
      expect(next!.getHours()).toBe(10);
      expect(next!.getMinutes()).toBe(0);
    });

    it("weekly: jumps to the requested day", () => {
      // from is Thursday May 7 2026 — request Monday (1)
      const next = computeNextOccurrence(
        { frequency: "weekly", dayOfWeek: 1, hour: 9, minute: 30 },
        from,
        0
      );
      expect(next).not.toBeNull();
      expect(next!.getDay()).toBe(1);
      expect(next!.getHours()).toBe(9);
      expect(next!.getMinutes()).toBe(30);
      // Should be the upcoming Monday, not today
      expect(next!.getTime()).toBeGreaterThan(from.getTime());
    });

    it("monthly: advances by interval months", () => {
      const next = computeNextOccurrence(
        { frequency: "monthly", dayOfMonth: 15, hour: 10, minute: 0 },
        from,
        0
      );
      expect(next).not.toBeNull();
      expect(next!.getDate()).toBe(15);
      // Month after May (6 = June, 0-indexed)
      expect(next!.getMonth()).toBe(from.getMonth() + 1);
    });

    it("returns null when maxCount reached", () => {
      const next = computeNextOccurrence(
        { frequency: "daily", hour: 10, minute: 0, maxCount: 3 },
        from,
        3
      );
      expect(next).toBeNull();
    });

    it("returns null when next > until", () => {
      const next = computeNextOccurrence(
        {
          frequency: "daily",
          hour: 10,
          minute: 0,
          until: "2026-05-07T20:00:00.000Z",
        },
        from,
        0
      );
      expect(next).toBeNull();
    });

    it("respects interval > 1 for daily", () => {
      const next = computeNextOccurrence(
        { frequency: "daily", interval: 3, hour: 10, minute: 0 },
        from,
        0
      );
      expect(next).not.toBeNull();
      expect(next!.getDate()).toBe(from.getDate() + 3);
    });
  });
});
