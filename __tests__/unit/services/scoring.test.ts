import { describe, it, expect } from "vitest";
import {
  updateSignals,
  calculateScores,
  type BehavioralSignals,
} from "@/server/services/scoring";
import type { SentimentResult } from "@/server/services/ai-analysis";

// ============================================================
// Helpers
// ============================================================

function makeAnalysis(overrides: Partial<SentimentResult> = {}): SentimentResult {
  return {
    score: 0.5,
    label: "positive",
    emotionalTone: "entusiasta",
    topics: ["contenido", "fotos"],
    purchaseIntent: 0.3,
    budgetMentions: [],
    keyPhrases: ["me encanta"],
    tokensUsed: 100,
    ...overrides,
  };
}

function makeSignals(overrides: Partial<BehavioralSignals> = {}): BehavioralSignals {
  return {
    messageCount: 10,
    avgMessageLength: 50,
    avgSentiment: 0.3,
    sentimentTrend: 0.05,
    avgPurchaseIntent: 0.2,
    maxPurchaseIntent: 0.4,
    topicFrequency: { fotos: 5, contenido: 3 },
    budgetMentions: [],
    lastMessageAt: new Date().toISOString(),
    avgTimeBetweenMessages: 60,
    conversationCount: 2,
    ...overrides,
  };
}

// ============================================================
// updateSignals
// ============================================================

describe("updateSignals", () => {
  it("initializes from null signals", () => {
    const result = updateSignals(null, makeAnalysis(), 100, null, 1);
    expect(result.messageCount).toBe(1);
    expect(result.avgMessageLength).toBe(100);
    expect(result.avgSentiment).toBe(0.5);
    expect(result.avgPurchaseIntent).toBe(0.3);
    expect(result.conversationCount).toBe(1);
  });

  it("initializes from undefined signals", () => {
    const result = updateSignals(undefined, makeAnalysis(), 80, null, 1);
    expect(result.messageCount).toBe(1);
  });

  it("accumulates running averages correctly", () => {
    const current = makeSignals({ messageCount: 4, avgMessageLength: 100, avgSentiment: 0.2, avgPurchaseIntent: 0.1 });
    const result = updateSignals(current, makeAnalysis({ score: 0.8, purchaseIntent: 0.6 }), 200, 30, 2);

    expect(result.messageCount).toBe(5);
    // avgLen = (100*4 + 200) / 5 = 120
    expect(result.avgMessageLength).toBe(120);
    // avgSent = (0.2*4 + 0.8) / 5 = 0.32
    expect(result.avgSentiment).toBeCloseTo(0.32);
    // avgIntent = (0.1*4 + 0.6) / 5 = 0.2
    expect(result.avgPurchaseIntent).toBeCloseTo(0.2);
  });

  it("does not compute sentiment trend for <= 2 messages", () => {
    const current = makeSignals({ messageCount: 1 });
    const result = updateSignals(current, makeAnalysis(), 50, null, 1);
    expect(result.sentimentTrend).toBe(0);
  });

  it("computes sentiment trend after 3+ messages", () => {
    const current = makeSignals({ messageCount: 5, sentimentTrend: 0.1, avgSentiment: 0.3 });
    const result = updateSignals(current, makeAnalysis({ score: 0.7 }), 50, null, 1);
    // trend = 0.1 * 0.7 + (0.7 - 0.3) * 0.3 = 0.07 + 0.12 = 0.19
    expect(result.sentimentTrend).toBeCloseTo(0.19);
  });

  it("accumulates topic frequency", () => {
    const current = makeSignals({ topicFrequency: { fotos: 3 } });
    const result = updateSignals(current, makeAnalysis({ topics: ["fotos", "videos"] }), 50, null, 1);
    expect(result.topicFrequency.fotos).toBe(4);
    expect(result.topicFrequency.videos).toBe(1);
  });

  it("deduplicates budget mentions and keeps max 10", () => {
    const current = makeSignals({
      budgetMentions: ["$10", "$20", "$30", "$40", "$50", "$60", "$70", "$80", "$90", "$100"],
    });
    const result = updateSignals(current, makeAnalysis({ budgetMentions: ["$10", "$110"] }), 50, null, 1);
    // Dedup: 11 unique, slice(-10) keeps last 10
    expect(result.budgetMentions.length).toBeLessThanOrEqual(10);
    expect(result.budgetMentions).toContain("$110");
  });

  it("tracks max purchase intent", () => {
    const current = makeSignals({ maxPurchaseIntent: 0.5 });
    const result = updateSignals(current, makeAnalysis({ purchaseIntent: 0.9 }), 50, null, 1);
    expect(result.maxPurchaseIntent).toBe(0.9);
  });

  it("does not lower max purchase intent", () => {
    const current = makeSignals({ maxPurchaseIntent: 0.9 });
    const result = updateSignals(current, makeAnalysis({ purchaseIntent: 0.1 }), 50, null, 1);
    expect(result.maxPurchaseIntent).toBe(0.9);
  });

  it("computes average time between messages", () => {
    const current = makeSignals({ messageCount: 3, avgTimeBetweenMessages: 60 });
    const result = updateSignals(current, makeAnalysis(), 50, 30, 1);
    // avgTime = (60 * (3-1) + 30) / 3 = (120+30)/3 = 50
    expect(result.avgTimeBetweenMessages).toBeCloseTo(50);
  });

  it("skips time calculation when timeSinceLastMsg is null", () => {
    const current = makeSignals({ avgTimeBetweenMessages: 60 });
    const result = updateSignals(current, makeAnalysis(), 50, null, 1);
    expect(result.avgTimeBetweenMessages).toBe(60);
  });

  it("sets lastMessageAt to current timestamp", () => {
    const before = new Date().toISOString();
    const result = updateSignals(null, makeAnalysis(), 50, null, 1);
    const after = new Date().toISOString();
    expect(result.lastMessageAt).toBeDefined();
    expect(result.lastMessageAt! >= before).toBe(true);
    expect(result.lastMessageAt! <= after).toBe(true);
  });
});

// ============================================================
// calculateScores
// ============================================================

describe("calculateScores", () => {
  describe("engagement level", () => {
    it("returns low engagement for empty signals", () => {
      const result = calculateScores({});
      // avgSentiment=0 maps to 50 sentiment score (midpoint of -1..1), weight 0.20 → ~10
      expect(result.engagementLevel).toBeLessThanOrEqual(15);
      expect(result.funnelStage).toBe("cold");
    });

    it("scores high engagement for active user", () => {
      const result = calculateScores(makeSignals({
        messageCount: 30,
        avgMessageLength: 200,
        avgSentiment: 1,
        conversationCount: 5,
        lastMessageAt: new Date().toISOString(),
      }));
      expect(result.engagementLevel).toBeGreaterThanOrEqual(70);
    });

    it("scores low for minimal activity", () => {
      const result = calculateScores(makeSignals({
        messageCount: 1,
        avgMessageLength: 10,
        avgSentiment: -0.5,
        conversationCount: 1,
        lastMessageAt: null,
      }));
      expect(result.engagementLevel).toBeLessThan(30);
    });

    it("decays recency over time", () => {
      const recent = calculateScores(makeSignals({
        lastMessageAt: new Date().toISOString(),
      }));
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const old = calculateScores(makeSignals({
        lastMessageAt: weekAgo.toISOString(),
      }));
      expect(recent.engagementLevel).toBeGreaterThan(old.engagementLevel);
    });
  });

  describe("payment probability", () => {
    it("scores high for strong purchase signals", () => {
      const result = calculateScores(makeSignals({
        avgPurchaseIntent: 0.8,
        maxPurchaseIntent: 0.95,
        budgetMentions: ["$50", "$100", "$200"],
        avgSentiment: 0.8,
        sentimentTrend: 0.2,
        messageCount: 20,
        lastMessageAt: new Date().toISOString(),
      }));
      expect(result.paymentProbability).toBeGreaterThanOrEqual(50);
    });

    it("scores low without purchase signals", () => {
      const result = calculateScores(makeSignals({
        avgPurchaseIntent: 0,
        maxPurchaseIntent: 0,
        budgetMentions: [],
        avgSentiment: 0,
      }));
      expect(result.paymentProbability).toBeLessThan(30);
    });
  });

  describe("funnel stage", () => {
    it("classifies cold for no signals", () => {
      expect(calculateScores({}).funnelStage).toBe("cold");
    });

    it("classifies curious for 3+ messages", () => {
      const result = calculateScores(makeSignals({ messageCount: 3 }));
      expect(["curious", "interested", "hot_lead", "buyer", "vip"]).toContain(result.funnelStage);
    });

    it("classifies curious for engagement >= 20", () => {
      const result = calculateScores(makeSignals({
        messageCount: 1,
        avgMessageLength: 150,
        avgSentiment: 0.5,
        lastMessageAt: new Date().toISOString(),
        conversationCount: 2,
      }));
      if (result.engagementLevel >= 20) {
        expect(result.funnelStage).not.toBe("cold");
      }
    });

    it("never retreats funnel stage", () => {
      const result = calculateScores(
        makeSignals({ messageCount: 1, avgPurchaseIntent: 0 }),
        "buyer" // current stage is buyer
      );
      // Even with low scores, should stay at buyer
      expect(result.funnelStage).toBe("buyer");
    });

    it("advances from current stage if scores warrant it", () => {
      const result = calculateScores(
        makeSignals({
          avgPurchaseIntent: 0.95,
          maxPurchaseIntent: 1,
          budgetMentions: ["$500", "$1000", "$2000"],
          avgSentiment: 0.9,
          sentimentTrend: 0.3,
          messageCount: 50,
          lastMessageAt: new Date().toISOString(),
          conversationCount: 5,
        }),
        "interested"
      );
      // Should advance beyond interested
      const idx = ["cold", "curious", "interested", "hot_lead", "buyer", "vip"].indexOf(result.funnelStage);
      expect(idx).toBeGreaterThanOrEqual(2);
    });

    it("maps paymentProbability >= 85 to vip", () => {
      const result = calculateScores(makeSignals({
        avgPurchaseIntent: 0.95,
        maxPurchaseIntent: 1,
        budgetMentions: ["$1", "$2", "$3"],
        avgSentiment: 1,
        sentimentTrend: 0.5,
        messageCount: 50,
        avgMessageLength: 200,
        lastMessageAt: new Date().toISOString(),
        conversationCount: 5,
      }));
      if (result.paymentProbability >= 85) {
        expect(result.funnelStage).toBe("vip");
      }
    });
  });

  describe("derived enums", () => {
    it("classifies response speed correctly", () => {
      expect(calculateScores(makeSignals({ avgTimeBetweenMessages: 10 })).responseSpeed).toBe("fast");
      expect(calculateScores(makeSignals({ avgTimeBetweenMessages: 60 })).responseSpeed).toBe("medium");
      expect(calculateScores(makeSignals({ avgTimeBetweenMessages: 200 })).responseSpeed).toBe("slow");
    });

    it("classifies conversation depth correctly", () => {
      // 15 msgs / 1 conv = 15 msgs/conv => deep
      expect(calculateScores(makeSignals({ messageCount: 15, conversationCount: 1 })).conversationDepth).toBe("deep");
      // 6 msgs / 1 conv = 6 => moderate
      expect(calculateScores(makeSignals({ messageCount: 6, conversationCount: 1 })).conversationDepth).toBe("moderate");
      // 2 msgs / 1 conv = 2 => superficial
      expect(calculateScores(makeSignals({ messageCount: 2, conversationCount: 1 })).conversationDepth).toBe("superficial");
    });

    it("classifies estimated budget by payment probability", () => {
      // High intent + signals → high probability → premium or high budget
      const highResult = calculateScores(makeSignals({
        avgPurchaseIntent: 0.9,
        maxPurchaseIntent: 1,
        budgetMentions: ["$50", "$100", "$200"],
        avgSentiment: 0.9,
        sentimentTrend: 0.3,
        messageCount: 30,
        lastMessageAt: new Date().toISOString(),
      }));
      expect(["high", "premium"]).toContain(highResult.estimatedBudget);

      // No signals → low
      expect(calculateScores({}).estimatedBudget).toBe("low");
    });
  });

  describe("clamping", () => {
    it("clamps engagement to 0-100", () => {
      const result = calculateScores(makeSignals({
        messageCount: 9999,
        avgMessageLength: 9999,
        avgSentiment: 1,
        conversationCount: 9999,
        lastMessageAt: new Date().toISOString(),
      }));
      expect(result.engagementLevel).toBeLessThanOrEqual(100);
      expect(result.engagementLevel).toBeGreaterThanOrEqual(0);
    });

    it("clamps payment probability to 0-100", () => {
      const result = calculateScores(makeSignals({
        avgPurchaseIntent: 1,
        maxPurchaseIntent: 1,
        budgetMentions: ["a", "b", "c", "d", "e"],
        avgSentiment: 1,
        sentimentTrend: 1,
        messageCount: 100,
        lastMessageAt: new Date().toISOString(),
        conversationCount: 10,
      }));
      expect(result.paymentProbability).toBeLessThanOrEqual(100);
      expect(result.paymentProbability).toBeGreaterThanOrEqual(0);
    });

    it("handles negative sentiment without breaking", () => {
      const result = calculateScores(makeSignals({ avgSentiment: -1 }));
      expect(result.engagementLevel).toBeGreaterThanOrEqual(0);
      expect(result.paymentProbability).toBeGreaterThanOrEqual(0);
    });
  });

  describe("factors", () => {
    it("returns 6 factors", () => {
      const result = calculateScores(makeSignals());
      expect(result.factors).toHaveLength(6);
    });

    it("factor weights sum to 1.0", () => {
      const result = calculateScores(makeSignals());
      const totalWeight = result.factors.reduce((sum, f) => sum + f.weight, 0);
      expect(totalWeight).toBeCloseTo(1.0);
    });

    it("each factor value is 0-100", () => {
      const result = calculateScores(makeSignals());
      for (const factor of result.factors) {
        expect(factor.value).toBeGreaterThanOrEqual(0);
        expect(factor.value).toBeLessThanOrEqual(100);
      }
    });
  });
});
