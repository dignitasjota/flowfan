/**
 * Simple recurrence rule helpers for scheduled posts.
 * Intentionally narrower than RFC5545 RRULE — covers daily/weekly/monthly
 * with one of each at a fixed time of day, optional end (until or maxCount).
 */

export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

export type RecurrenceRule = {
  frequency: RecurrenceFrequency;
  /** Every N units (1 = each, 2 = every other, etc.). Defaults to 1. */
  interval?: number;
  /** 0 = Sunday … 6 = Saturday. Required when frequency = "weekly". */
  dayOfWeek?: number;
  /** 1-31. Required when frequency = "monthly". */
  dayOfMonth?: number;
  /** Hour of day in the creator's timezone (0-23). */
  hour: number;
  /** Minute of hour (0-59). */
  minute: number;
  /** ISO date string. Series ends on or before this instant. */
  until?: string;
  /** Stop after this many publishes (counted including the first). */
  maxCount?: number;
};

function clone(d: Date): Date {
  return new Date(d.getTime());
}

function setTime(d: Date, hour: number, minute: number): Date {
  const next = clone(d);
  next.setHours(hour, minute, 0, 0);
  return next;
}

/**
 * Compute the next scheduled occurrence after `from` (exclusive).
 * Returns null if the rule has expired by `until` or by `maxCount`.
 */
export function computeNextOccurrence(
  rule: RecurrenceRule,
  from: Date,
  occurrencesSoFar: number
): Date | null {
  if (rule.maxCount && occurrencesSoFar >= rule.maxCount) return null;

  const interval = Math.max(1, rule.interval ?? 1);
  let next: Date;

  switch (rule.frequency) {
    case "daily": {
      next = setTime(from, rule.hour, rule.minute);
      // Always advance at least one interval forward
      next.setDate(next.getDate() + interval);
      break;
    }
    case "weekly": {
      const target = (rule.dayOfWeek ?? from.getDay()) % 7;
      next = setTime(from, rule.hour, rule.minute);
      const currentDay = next.getDay();
      let delta = (target - currentDay + 7) % 7;
      if (delta === 0) delta = 7 * interval;
      else if (interval > 1) delta += 7 * (interval - 1);
      next.setDate(next.getDate() + delta);
      break;
    }
    case "monthly": {
      const day = Math.min(28, Math.max(1, rule.dayOfMonth ?? 1));
      next = setTime(from, rule.hour, rule.minute);
      next.setDate(1); // avoid overflow when adding months
      next.setMonth(next.getMonth() + interval);
      next.setDate(day);
      break;
    }
    default:
      return null;
  }

  if (rule.until) {
    const limit = new Date(rule.until);
    if (next.getTime() > limit.getTime()) return null;
  }

  return next;
}

/**
 * Validate a recurrence rule object. Throws on invalid input.
 */
export function validateRecurrenceRule(rule: RecurrenceRule): void {
  if (!["daily", "weekly", "monthly"].includes(rule.frequency)) {
    throw new Error("Invalid recurrence frequency");
  }
  if (rule.hour < 0 || rule.hour > 23) {
    throw new Error("Invalid recurrence hour");
  }
  if (rule.minute < 0 || rule.minute > 59) {
    throw new Error("Invalid recurrence minute");
  }
  if (rule.frequency === "weekly") {
    if (rule.dayOfWeek === undefined || rule.dayOfWeek < 0 || rule.dayOfWeek > 6) {
      throw new Error("Weekly recurrence requires dayOfWeek (0-6)");
    }
  }
  if (rule.frequency === "monthly") {
    if (
      rule.dayOfMonth === undefined ||
      rule.dayOfMonth < 1 ||
      rule.dayOfMonth > 31
    ) {
      throw new Error("Monthly recurrence requires dayOfMonth (1-31)");
    }
  }
  if (rule.interval !== undefined && (rule.interval < 1 || rule.interval > 60)) {
    throw new Error("Recurrence interval out of range (1-60)");
  }
  if (rule.maxCount !== undefined && rule.maxCount < 1) {
    throw new Error("maxCount must be >= 1");
  }
}
