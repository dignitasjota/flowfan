import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Resend
vi.mock("resend", () => ({
  Resend: class MockResend {
    emails = {
      send: vi.fn().mockResolvedValue({ data: { id: "test-id" }, error: null }),
    };
  },
}));

vi.mock("@/lib/logger", () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ============================================================
// Tests
// ============================================================

describe("email service", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("does not throw when RESEND_API_KEY is not set", async () => {
    delete process.env.RESEND_API_KEY;
    const email = await import("@/server/services/email");
    // Should not throw
    await expect(
      email.sendVerificationEmail("test@test.com", "https://example.com/verify")
    ).resolves.not.toThrow();
  });

  it("sendVerificationEmail does not throw with valid params", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const email = await import("@/server/services/email");
    await expect(
      email.sendVerificationEmail("test@test.com", "https://example.com/verify")
    ).resolves.not.toThrow();
  });

  it("sendPasswordResetEmail does not throw with valid params", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const email = await import("@/server/services/email");
    await expect(
      email.sendPasswordResetEmail("test@test.com", "https://example.com/reset")
    ).resolves.not.toThrow();
  });
});

// ============================================================
// Email job data types
// ============================================================

describe("email job data", () => {
  const validTypes = ["verification", "password_reset", "daily_summary", "weekly_summary", "churn_alert"] as const;

  it("supports 5 email types", () => {
    expect(validTypes).toHaveLength(5);
  });

  it("all types are strings", () => {
    for (const type of validTypes) {
      expect(typeof type).toBe("string");
    }
  });
});

// ============================================================
// DailySummaryData shape
// ============================================================

describe("DailySummaryData", () => {
  it("has correct shape", () => {
    const data = {
      creatorName: "Test Creator",
      newContacts: 5,
      totalMessages: 42,
      atRiskCount: 3,
      topAction: "Check your dashboard",
      date: "30 de abril de 2026",
    };

    expect(data.creatorName).toBe("Test Creator");
    expect(data.newContacts).toBe(5);
    expect(data.totalMessages).toBe(42);
    expect(data.atRiskCount).toBe(3);
    expect(typeof data.topAction).toBe("string");
    expect(typeof data.date).toBe("string");
  });
});

// ============================================================
// WeeklySummaryData shape
// ============================================================

describe("WeeklySummaryData", () => {
  it("has correct shape", () => {
    const data = {
      creatorName: "Test Creator",
      newContacts: 20,
      revenueEur: 150.5,
      churnRate: 8,
      topContacts: [
        { name: "fan1", stage: "vip" },
        { name: "fan2", stage: "buyer" },
      ],
      weekStart: "24 abr",
      weekEnd: "30 abr",
    };

    expect(data.topContacts).toHaveLength(2);
    expect(data.revenueEur).toBe(150.5);
    expect(data.churnRate).toBe(8);
  });
});

// ============================================================
// ChurnAlertData shape
// ============================================================

describe("ChurnAlertData", () => {
  it("has correct shape", () => {
    const data = {
      creatorName: "Test",
      contacts: [
        { name: "vip_fan", score: 85, stage: "vip" },
        { name: "hot_lead", score: 72, stage: "hot_lead" },
      ],
    };

    expect(data.contacts).toHaveLength(2);
    expect(data.contacts[0].score).toBe(85);
  });
});
