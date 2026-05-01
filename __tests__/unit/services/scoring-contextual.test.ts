import { describe, it, expect } from "vitest";
import {
  calculateScores,
  mergeScoringConfig,
  DEFAULT_ENGAGEMENT_WEIGHTS,
  DEFAULT_PAYMENT_WEIGHTS,
  DEFAULT_BENCHMARKS,
  DEFAULT_FUNNEL_THRESHOLDS,
  DEFAULT_CONTACT_AGE_FACTOR,
  PLATFORM_SCORING_DEFAULTS,
  type BehavioralSignals,
  type ScoringConfig,
} from "@/server/services/scoring";

const baseSignals: BehavioralSignals = {
  messageCount: 10,
  avgMessageLength: 80,
  avgSentiment: 0.3,
  sentimentTrend: 0.1,
  avgPurchaseIntent: 0.4,
  maxPurchaseIntent: 0.7,
  topicFrequency: { pricing: 3, content: 5 },
  budgetMentions: ["$50"],
  lastMessageAt: new Date().toISOString(),
  avgTimeBetweenMessages: 60,
  conversationCount: 3,
};

describe("Scoring Contextual", () => {
  describe("calculateScores regression", () => {
    it("produces identical result without config (backward compat)", () => {
      const withoutConfig = calculateScores(baseSignals, "cold");
      const withEmptyConfig = calculateScores(baseSignals, "cold", undefined, undefined, undefined);

      expect(withoutConfig.engagementLevel).toBe(withEmptyConfig.engagementLevel);
      expect(withoutConfig.paymentProbability).toBe(withEmptyConfig.paymentProbability);
      expect(withoutConfig.funnelStage).toBe(withEmptyConfig.funnelStage);
    });

    it("returns valid ranges for all fields", () => {
      const result = calculateScores(baseSignals);
      expect(result.engagementLevel).toBeGreaterThanOrEqual(0);
      expect(result.engagementLevel).toBeLessThanOrEqual(100);
      expect(result.paymentProbability).toBeGreaterThanOrEqual(0);
      expect(result.paymentProbability).toBeLessThanOrEqual(100);
      expect(["cold", "curious", "interested", "hot_lead", "buyer", "vip"]).toContain(result.funnelStage);
      expect(["fast", "medium", "slow"]).toContain(result.responseSpeed);
      expect(["superficial", "moderate", "deep"]).toContain(result.conversationDepth);
      expect(["low", "medium", "high", "premium"]).toContain(result.estimatedBudget);
    });

    it("handles empty signals gracefully", () => {
      const result = calculateScores({} as any);
      // Sentiment of 0 maps to 50% (neutral), so engagement/payment won't be exactly 0
      expect(result.engagementLevel).toBeLessThanOrEqual(15);
      expect(result.paymentProbability).toBeLessThanOrEqual(15);
      expect(result.funnelStage).toBe("cold");
    });
  });

  describe("config overrides", () => {
    it("custom engagement weights change engagement level", () => {
      const defaultResult = calculateScores(baseSignals);
      const config: ScoringConfig = {
        engagementWeights: {
          frequency: 0.60,
          msgLength: 0.05,
          sentiment: 0.05,
          depth: 0.05,
          recency: 0.20,
          convCount: 0.05,
        },
      };
      const customResult = calculateScores(baseSignals, undefined, config);

      expect(customResult.engagementLevel).not.toBe(defaultResult.engagementLevel);
    });

    it("custom payment weights change payment probability", () => {
      const defaultResult = calculateScores(baseSignals);
      const config: ScoringConfig = {
        paymentWeights: {
          intent: 0.60,
          budget: 0.10,
          engagement: 0.10,
          momentum: 0.10,
          sentiment: 0.10,
        },
      };
      const customResult = calculateScores(baseSignals, undefined, config);

      expect(customResult.paymentProbability).not.toBe(defaultResult.paymentProbability);
    });

    it("custom benchmarks change scoring thresholds", () => {
      const defaultResult = calculateScores(baseSignals);
      const config: ScoringConfig = {
        benchmarks: { maxMessages: 5, maxMsgLength: 50 },
      };
      const customResult = calculateScores(baseSignals, undefined, config);

      // Lower maxMessages means 10 messages saturates the score
      expect(customResult.engagementLevel).toBeGreaterThanOrEqual(defaultResult.engagementLevel);
    });

    it("custom funnel thresholds change funnel stage", () => {
      const config: ScoringConfig = {
        funnelThresholds: { vip: 10, buyer: 5, hotLead: 3, interested: 2, curious: 1 },
      };
      const result = calculateScores(baseSignals, undefined, config);

      expect(result.funnelStage).toBe("vip");
    });
  });

  describe("platform defaults", () => {
    it("onlyfans has different benchmarks", () => {
      const defaultResult = calculateScores(baseSignals, undefined, undefined, undefined);
      const ofResult = calculateScores(baseSignals, undefined, undefined, "onlyfans");

      expect(ofResult.engagementLevel).not.toBe(defaultResult.engagementLevel);
    });

    it("telegram has different benchmarks", () => {
      const defaultResult = calculateScores(baseSignals, undefined, undefined, undefined);
      const tgResult = calculateScores(baseSignals, undefined, undefined, "telegram");

      expect(tgResult.engagementLevel).not.toBe(defaultResult.engagementLevel);
    });

    it("unknown platform uses global defaults", () => {
      const defaultResult = calculateScores(baseSignals, undefined, undefined, undefined);
      const unknownResult = calculateScores(baseSignals, undefined, undefined, "unknownplatform");

      expect(unknownResult.engagementLevel).toBe(defaultResult.engagementLevel);
      expect(unknownResult.paymentProbability).toBe(defaultResult.paymentProbability);
    });
  });

  describe("mergeScoringConfig", () => {
    it("returns defaults with no platform or override", () => {
      const { ew, pw, bm, ft, af } = mergeScoringConfig();

      expect(ew).toEqual(DEFAULT_ENGAGEMENT_WEIGHTS);
      expect(pw).toEqual(DEFAULT_PAYMENT_WEIGHTS);
      expect(bm).toEqual(DEFAULT_BENCHMARKS);
      expect(ft).toEqual(DEFAULT_FUNNEL_THRESHOLDS);
      expect(af).toEqual(DEFAULT_CONTACT_AGE_FACTOR);
    });

    it("merges platform defaults over global defaults", () => {
      const { bm, pw } = mergeScoringConfig("onlyfans");

      expect(bm.maxMsgLength).toBe(100); // onlyfans override
      expect(bm.maxMessages).toBe(15); // onlyfans override
      expect(pw.intent).toBe(0.35); // onlyfans override
      expect(bm.recencyHours).toBe(168); // global default (not overridden)
    });

    it("creator override takes precedence over platform defaults", () => {
      const override: ScoringConfig = {
        benchmarks: { maxMsgLength: 300 },
      };
      const { bm } = mergeScoringConfig("onlyfans", override);

      expect(bm.maxMsgLength).toBe(300); // creator override wins
      expect(bm.maxMessages).toBe(15); // onlyfans default (not overridden by creator)
    });

    it("three-layer merge works correctly", () => {
      const override: ScoringConfig = {
        engagementWeights: { frequency: 0.50 },
        paymentWeights: { intent: 0.10 },
      };
      const { ew, pw, bm } = mergeScoringConfig("onlyfans", override);

      // Creator override
      expect(ew.frequency).toBe(0.50);
      expect(pw.intent).toBe(0.10);
      // Platform default (not overridden)
      expect(bm.maxMsgLength).toBe(100);
      // Global default
      expect(ew.sentiment).toBe(0.20);
    });
  });

  describe("contact age factor", () => {
    it("boosts engagement for new contacts when enabled", () => {
      const config: ScoringConfig = {
        contactAgeFactor: { enabled: true, newContactDays: 14, boostFactor: 1.5 },
      };
      const recentContact = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago

      const withoutAge = calculateScores(baseSignals);
      const withAge = calculateScores(baseSignals, undefined, config, undefined, recentContact);

      expect(withAge.engagementLevel).toBeGreaterThan(withoutAge.engagementLevel);
    });

    it("no boost for old contacts", () => {
      const config: ScoringConfig = {
        contactAgeFactor: { enabled: true, newContactDays: 14, boostFactor: 1.5 },
      };
      const oldContact = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

      const withoutAge = calculateScores(baseSignals);
      const withAge = calculateScores(baseSignals, undefined, config, undefined, oldContact);

      expect(withAge.engagementLevel).toBe(withoutAge.engagementLevel);
    });

    it("disabled by default", () => {
      const recentContact = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

      const withoutAge = calculateScores(baseSignals);
      const withAge = calculateScores(baseSignals, undefined, undefined, undefined, recentContact);

      expect(withAge.engagementLevel).toBe(withoutAge.engagementLevel);
    });

    it("boost decreases linearly as contact ages", () => {
      const config: ScoringConfig = {
        contactAgeFactor: { enabled: true, newContactDays: 14, boostFactor: 1.5 },
      };
      const veryNew = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day
      const midAge = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days
      const almostOld = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000); // 13 days

      const scoreNew = calculateScores(baseSignals, undefined, config, undefined, veryNew);
      const scoreMid = calculateScores(baseSignals, undefined, config, undefined, midAge);
      const scoreOld = calculateScores(baseSignals, undefined, config, undefined, almostOld);

      expect(scoreNew.engagementLevel).toBeGreaterThan(scoreMid.engagementLevel);
      expect(scoreMid.engagementLevel).toBeGreaterThan(scoreOld.engagementLevel);
    });
  });

  describe("funnel stage never retreats", () => {
    it("keeps higher funnel stage when new score is lower", () => {
      const lowSignals: BehavioralSignals = {
        ...baseSignals,
        messageCount: 1,
        avgPurchaseIntent: 0,
        maxPurchaseIntent: 0,
        budgetMentions: [],
        avgSentiment: -0.5,
      };

      const result = calculateScores(lowSignals, "buyer");
      expect(["buyer", "vip"]).toContain(result.funnelStage);
    });
  });
});
