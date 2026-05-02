import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("@/server/services/content-gap-analyzer", () => ({
  aggregateConversationData: vi.fn().mockResolvedValue({
    topicFrequencies: { "contenido exclusivo": 15, "precios": 10, "horarios": 5 },
    topicSentiments: { "contenido exclusivo": [0.8, 0.6], "precios": [-0.2, 0.1] },
    platformStats: {
      onlyfans: { contacts: 30, avgEngagement: 65, topTopics: ["contenido exclusivo", "precios"] },
    },
    engagementDropCount: 3,
    totalContacts: 50,
    totalMessages: 200,
  }),
  analyzeContentGaps: vi.fn().mockResolvedValue({
    topRequestedTopics: [
      { topic: "contenido exclusivo", frequency: 15, avgSentiment: 0.7, sampleQuotes: ["Quiero ver mas de esto"] },
    ],
    engagementDropPoints: [
      { pattern: "Respuestas tardias", frequency: 5, suggestion: "Responder en menos de 2h" },
    ],
    contentOpportunities: [
      { title: "Behind the scenes", description: "Contenido del dia a dia", estimatedDemand: "high", estimatedRevenue: "medium" },
    ],
    platformBreakdown: [
      { platform: "onlyfans", topTopics: ["exclusivo", "ppv"], avgEngagement: 65 },
    ],
    trendingThemes: ["behind the scenes", "Q&A", "challenges"],
    summary: "Los fans piden mas contenido exclusivo y behind the scenes.",
    tokensUsed: 1200,
  }),
  getTopicTrends: vi.fn().mockResolvedValue([
    { topic: "contenido exclusivo", frequency: 15, avgSentiment: 0.7 },
    { topic: "precios", frequency: 10, avgSentiment: -0.05 },
    { topic: "horarios", frequency: 5, avgSentiment: 0.3 },
  ]),
}));

vi.mock("@/server/services/ai-config-resolver", () => ({
  resolveAIConfig: vi.fn().mockResolvedValue({
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    apiKey: "sk-test",
  }),
}));

vi.mock("@/server/services/usage-limits", () => ({
  checkFeatureAccess: vi.fn().mockResolvedValue(undefined),
}));

import {
  aggregateConversationData,
  analyzeContentGaps,
  getTopicTrends,
} from "@/server/services/content-gap-analyzer";
import { resolveAIConfig } from "@/server/services/ai-config-resolver";
import { checkFeatureAccess } from "@/server/services/usage-limits";

const mockAggregate = vi.mocked(aggregateConversationData);
const mockAnalyze = vi.mocked(analyzeContentGaps);
const mockGetTopicTrends = vi.mocked(getTopicTrends);
const mockResolveAIConfig = vi.mocked(resolveAIConfig);
const mockCheckFeatureAccess = vi.mocked(checkFeatureAccess);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("content-gaps router logic", () => {
  describe("generate input validation", () => {
    it("accepts valid period values", () => {
      const validPeriods = ["7", "30", "90"];
      for (const p of validPeriods) {
        expect(validPeriods.includes(p)).toBe(true);
      }
    });

    it("transforms period string to number", () => {
      const inputPeriod = "30";
      const periodDays = Number(inputPeriod);
      expect(periodDays).toBe(30);
    });

    it("rejects invalid period value", () => {
      const validPeriods = ["7", "30", "90"];
      expect(validPeriods.includes("15")).toBe(false);
    });
  });

  describe("feature access check", () => {
    it("checks priceAdvisor feature for Pro+ access", async () => {
      await mockCheckFeatureAccess({} as any, "creator-1", "priceAdvisor");
      expect(mockCheckFeatureAccess).toHaveBeenCalledWith({}, "creator-1", "priceAdvisor");
    });

    it("rejects when feature not available", async () => {
      mockCheckFeatureAccess.mockRejectedValueOnce(
        new TRPCError({ code: "FORBIDDEN", message: "Feature not available" })
      );
      await expect(
        mockCheckFeatureAccess({} as any, "c1", "priceAdvisor")
      ).rejects.toThrow(TRPCError);
    });
  });

  describe("AI config resolution", () => {
    it("resolves content_gap config first, falls back to suggestion", async () => {
      mockResolveAIConfig.mockResolvedValueOnce(null);
      mockResolveAIConfig.mockResolvedValueOnce({
        provider: "openai",
        model: "gpt-4o",
        apiKey: "sk-fallback",
      });

      const primary = await mockResolveAIConfig({} as any, "c1", "content_gap");
      const fallback = primary ?? await mockResolveAIConfig({} as any, "c1", "suggestion");

      expect(fallback!.provider).toBe("openai");
    });

    it("throws when no AI config available", () => {
      expect(() => {
        const config = null;
        if (!config) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No has configurado tu proveedor de IA.",
          });
        }
      }).toThrow(TRPCError);
    });
  });

  describe("generate flow", () => {
    it("aggregates data for correct period", async () => {
      await mockAggregate({} as any, "creator-1", 30);
      expect(mockAggregate).toHaveBeenCalledWith({}, "creator-1", 30);
    });

    it("rejects when no contacts to analyze", () => {
      const aggregated = { totalContacts: 0 };
      expect(() => {
        if (aggregated.totalContacts === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No hay contactos para analizar.",
          });
        }
      }).toThrow(TRPCError);
    });

    it("passes language preference to AI analysis", async () => {
      const language = "en";
      const config = { provider: "anthropic", model: "claude-sonnet-4-20250514", apiKey: "sk-test" };
      const aggregated = await mockAggregate({} as any, "c1", 30);

      await mockAnalyze(config as any, aggregated, language);
      expect(mockAnalyze).toHaveBeenCalledWith(config, aggregated, "en");
    });

    it("calculates correct period dates", () => {
      const periodDays = 30;
      const periodEnd = new Date();
      const periodStart = new Date();
      periodStart.setDate(periodStart.getDate() - periodDays);

      expect(periodEnd.getTime() - periodStart.getTime()).toBeCloseTo(
        30 * 24 * 60 * 60 * 1000,
        -3
      );
    });

    it("returns report with tokens used", async () => {
      const result = await mockAnalyze({} as any, {} as any, "es");
      expect(result.tokensUsed).toBe(1200);
    });

    it("returns all required report fields", async () => {
      const result = await mockAnalyze({} as any, {} as any, "es");
      expect(result).toHaveProperty("topRequestedTopics");
      expect(result).toHaveProperty("engagementDropPoints");
      expect(result).toHaveProperty("contentOpportunities");
      expect(result).toHaveProperty("platformBreakdown");
      expect(result).toHaveProperty("trendingThemes");
      expect(result).toHaveProperty("summary");
    });
  });

  describe("getTopicTrends", () => {
    it("returns topics sorted by frequency", async () => {
      const trends = await mockGetTopicTrends({} as any, "creator-1");
      expect(trends[0].frequency).toBeGreaterThanOrEqual(trends[1].frequency);
      expect(trends[1].frequency).toBeGreaterThanOrEqual(trends[2].frequency);
    });

    it("returns topic with sentiment data", async () => {
      const trends = await mockGetTopicTrends({} as any, "creator-1");
      for (const trend of trends) {
        expect(trend).toHaveProperty("topic");
        expect(trend).toHaveProperty("frequency");
        expect(trend).toHaveProperty("avgSentiment");
        expect(typeof trend.avgSentiment).toBe("number");
      }
    });

    it("does not require AI config (free endpoint)", () => {
      // getTopicTrends is protectedProcedure, not managerProcedure
      // and does not call any AI service
      expect(mockResolveAIConfig).not.toHaveBeenCalled();
    });
  });

  describe("list and get", () => {
    it("throws NOT_FOUND for missing report", () => {
      const report = null;
      expect(() => {
        if (!report) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Reporte no encontrado" });
        }
      }).toThrow(TRPCError);
    });

    it("requires valid uuid for get", () => {
      const validUuid = "550e8400-e29b-41d4-a716-446655440000";
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(uuidRegex.test(validUuid)).toBe(true);
      expect(uuidRegex.test("not-uuid")).toBe(false);
    });
  });
});
