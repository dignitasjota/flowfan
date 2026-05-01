import { describe, it, expect } from "vitest";
import { calculateChurnScore, getSuggestedActions, type ChurnResult } from "@/server/services/churn-prediction";
import type { BehavioralSignals } from "@/server/services/scoring";

// ============================================================
// Helpers
// ============================================================

function makeSignals(overrides: Partial<BehavioralSignals> = {}): BehavioralSignals {
  return {
    messageCount: 20,
    avgMessageLength: 60,
    avgSentiment: 0.5,
    sentimentTrend: 0.1,
    avgPurchaseIntent: 0.3,
    maxPurchaseIntent: 0.5,
    topicFrequency: {},
    budgetMentions: [],
    lastMessageAt: new Date().toISOString(),
    avgTimeBetweenMessages: 120,
    conversationCount: 3,
    ...overrides,
  };
}

function makeProfile(overrides: Partial<{ engagementLevel: number; funnelStage: string; scoringHistory: unknown }> = {}) {
  return {
    engagementLevel: 60,
    funnelStage: "interested",
    scoringHistory: [],
    ...overrides,
  };
}

function makeContact(daysAgo: number) {
  return {
    lastInteractionAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
  };
}

// ============================================================
// Score calculation
// ============================================================

describe("churn-prediction — calculateChurnScore", () => {
  it("active contact has low churn score", () => {
    const result = calculateChurnScore(makeSignals(), makeProfile(), makeContact(0));
    expect(result.score).toBeLessThan(30);
    expect(result.riskLevel).toBe("low");
  });

  it("contact inactive 30 days has high churn score", () => {
    const result = calculateChurnScore(
      makeSignals({ sentimentTrend: -0.2, avgTimeBetweenMessages: 5000 }),
      makeProfile({ funnelStage: "curious", engagementLevel: 30 }),
      makeContact(30)
    );
    expect(result.score).toBeGreaterThan(50);
    expect(["high", "critical"]).toContain(result.riskLevel);
  });

  it("contact inactive 60 days has very high churn score", () => {
    const result = calculateChurnScore(
      makeSignals({ sentimentTrend: -0.3, avgTimeBetweenMessages: 10000 }),
      makeProfile({ funnelStage: "cold", engagementLevel: 10 }),
      makeContact(60)
    );
    expect(result.score).toBeGreaterThan(60);
  });

  it("VIP with recent activity has very low churn", () => {
    const result = calculateChurnScore(
      makeSignals({ avgTimeBetweenMessages: 30 }),
      makeProfile({ funnelStage: "vip", engagementLevel: 90 }),
      makeContact(1)
    );
    expect(result.score).toBeLessThan(20);
    expect(result.riskLevel).toBe("low");
  });

  it("cold contact has higher base churn than VIP", () => {
    const coldResult = calculateChurnScore(makeSignals(), makeProfile({ funnelStage: "cold" }), makeContact(7));
    const vipResult = calculateChurnScore(makeSignals(), makeProfile({ funnelStage: "vip" }), makeContact(7));
    expect(coldResult.score).toBeGreaterThan(vipResult.score);
  });

  it("negative sentiment trend increases churn", () => {
    const negativeResult = calculateChurnScore(
      makeSignals({ sentimentTrend: -0.5 }),
      makeProfile(),
      makeContact(7)
    );
    const positiveResult = calculateChurnScore(
      makeSignals({ sentimentTrend: 0.5 }),
      makeProfile(),
      makeContact(7)
    );
    expect(negativeResult.score).toBeGreaterThan(positiveResult.score);
  });

  it("engagement drop from peak increases churn", () => {
    const history = [
      { engagementLevel: 80, paymentProbability: 50, funnelStage: "hot_lead", sentiment: 0.7, timestamp: "2026-01-01" },
      { engagementLevel: 85, paymentProbability: 55, funnelStage: "hot_lead", sentiment: 0.8, timestamp: "2026-02-01" },
    ];

    const droppedResult = calculateChurnScore(
      makeSignals(),
      makeProfile({ engagementLevel: 30, scoringHistory: history }),
      makeContact(7)
    );
    const stableResult = calculateChurnScore(
      makeSignals(),
      makeProfile({ engagementLevel: 80, scoringHistory: history }),
      makeContact(7)
    );

    expect(droppedResult.score).toBeGreaterThan(stableResult.score);
  });

  it("score is always between 0 and 100", () => {
    const extremeLow = calculateChurnScore(
      makeSignals({ sentimentTrend: 1, avgTimeBetweenMessages: 10 }),
      makeProfile({ funnelStage: "vip", engagementLevel: 100 }),
      makeContact(0)
    );
    expect(extremeLow.score).toBeGreaterThanOrEqual(0);
    expect(extremeLow.score).toBeLessThanOrEqual(100);

    const extremeHigh = calculateChurnScore(
      makeSignals({ sentimentTrend: -1, avgTimeBetweenMessages: 50000, messageCount: 2 }),
      makeProfile({ funnelStage: "cold", engagementLevel: 0 }),
      makeContact(90)
    );
    expect(extremeHigh.score).toBeGreaterThanOrEqual(0);
    expect(extremeHigh.score).toBeLessThanOrEqual(100);
  });

  it("returns 5 factors", () => {
    const result = calculateChurnScore(makeSignals(), makeProfile(), makeContact(5));
    expect(result.factors).toHaveLength(5);
    expect(result.factors.map((f) => f.name)).toEqual([
      "recency",
      "engagement_drop",
      "sentiment_trend",
      "frequency_decline",
      "funnel_stage",
    ]);
  });

  it("factor weights sum to 1", () => {
    const result = calculateChurnScore(makeSignals(), makeProfile(), makeContact(5));
    const totalWeight = result.factors.reduce((sum, f) => sum + f.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0);
  });

  it("handles null signals gracefully", () => {
    const result = calculateChurnScore(null, makeProfile(), makeContact(10));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// ============================================================
// Risk levels
// ============================================================

describe("churn-prediction — risk levels", () => {
  it("low: 0-24", () => {
    const result = calculateChurnScore(
      makeSignals({ avgTimeBetweenMessages: 30 }),
      makeProfile({ funnelStage: "vip", engagementLevel: 90 }),
      makeContact(0)
    );
    expect(result.riskLevel).toBe("low");
  });

  it("critical: 75-100", () => {
    const history = [
      { engagementLevel: 95, paymentProbability: 80, funnelStage: "vip", sentiment: 0.9, timestamp: "2026-01-01" },
      { engagementLevel: 90, paymentProbability: 75, funnelStage: "vip", sentiment: 0.8, timestamp: "2026-02-01" },
    ];
    const result = calculateChurnScore(
      makeSignals({ sentimentTrend: -1, avgTimeBetweenMessages: 50000, messageCount: 2 }),
      makeProfile({ funnelStage: "cold", engagementLevel: 2, scoringHistory: history }),
      makeContact(90)
    );
    expect(result.riskLevel).toBe("critical");
  });
});

// ============================================================
// Suggested actions
// ============================================================

describe("churn-prediction — suggested actions", () => {
  it("returns 3 actions for VIP", () => {
    const actions = getSuggestedActions("vip");
    expect(actions).toHaveLength(3);
  });

  it("returns 3 actions for cold", () => {
    const actions = getSuggestedActions("cold");
    expect(actions).toHaveLength(3);
  });

  it("returns actions for unknown stage", () => {
    const actions = getSuggestedActions("unknown_stage");
    expect(actions).toHaveLength(3);
  });

  it("VIP actions differ from cold actions", () => {
    const vipActions = getSuggestedActions("vip");
    const coldActions = getSuggestedActions("cold");
    expect(vipActions[0]).not.toBe(coldActions[0]);
  });
});
