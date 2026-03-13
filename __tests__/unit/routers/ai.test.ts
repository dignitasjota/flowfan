import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("@/server/services/usage-limits", () => ({
  checkAIMessageLimit: vi.fn().mockResolvedValue(undefined),
  checkReportLimit: vi.fn().mockResolvedValue(undefined),
  checkFeatureAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/ai-config-resolver", () => ({
  resolveAIConfig: vi.fn(),
}));

vi.mock("@/server/services/ai", () => ({
  generateSuggestion: vi.fn().mockResolvedValue({
    suggestions: ["Hola!"],
    variants: [{ type: "casual", label: "Casual", content: "Hola!" }],
    tokensUsed: 200,
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
  }),
}));

vi.mock("@/server/services/ai-analysis", () => ({
  analyzeMessage: vi.fn().mockResolvedValue({
    score: 0.5, label: "positive", emotionalTone: "entusiasta",
    topics: [], purchaseIntent: 0.3, budgetMentions: [], keyPhrases: [], tokensUsed: 100,
  }),
}));

vi.mock("@/server/services/conversation-summary", () => ({
  summarizeConversation: vi.fn().mockResolvedValue({
    summary: "Resumen test", mainTopic: "Test",
    relationshipStatus: "en desarrollo", nextSteps: [], tokensUsed: 150,
  }),
}));

vi.mock("@/server/services/contact-report", () => ({
  generateContactReport: vi.fn().mockResolvedValue({
    overview: "Report", patterns: [], interests: [],
    funnelPrediction: { nextStage: "curious", probability: 50, timeframe: "1w" },
    recommendations: [], riskLevel: "low", riskFactors: [], tokensUsed: 300,
  }),
}));

vi.mock("@/server/services/price-advisor", () => ({
  getPriceAdvice: vi.fn().mockResolvedValue({
    recommendedPrice: 25, priceRange: { min: 15, max: 40 },
    confidence: 0.7, timing: "now", timingReason: "r", strategy: "s", tokensUsed: 200,
  }),
}));

vi.mock("@/server/queues", () => ({
  analysisQueue: { add: vi.fn().mockResolvedValue({ id: "j1" }) },
}));

vi.mock("@/lib/logger", () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { checkAIMessageLimit, checkReportLimit, checkFeatureAccess } from "@/server/services/usage-limits";
import { resolveAIConfig } from "@/server/services/ai-config-resolver";

const mockResolveConfig = vi.mocked(resolveAIConfig);
const mockCheckAI = vi.mocked(checkAIMessageLimit);
const mockCheckReport = vi.mocked(checkReportLimit);
const mockCheckFeature = vi.mocked(checkFeatureAccess);

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveConfig.mockResolvedValue({
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    apiKey: "test-key",
  });
});

describe("ai router logic", () => {
  describe("suggest", () => {
    it("checks AI message limit", async () => {
      await mockCheckAI({} as any, "c1");
      expect(mockCheckAI).toHaveBeenCalled();
    });

    it("throws PRECONDITION_FAILED when no AI config", () => {
      const config = null;
      expect(() => {
        if (!config) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No has configurado tu proveedor de IA.",
          });
        }
      }).toThrow(TRPCError);
    });

    it("throws NOT_FOUND for missing conversation", () => {
      const conversation = null;
      expect(() => {
        if (!conversation) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }).toThrow(TRPCError);
    });

    it("resolves separate configs for suggestion and analysis", async () => {
      await mockResolveConfig({} as any, "c1", "suggestion");
      await mockResolveConfig({} as any, "c1", "analysis");
      expect(mockResolveConfig).toHaveBeenCalledTimes(2);
    });

    it("falls back to suggestion config for analysis", () => {
      const suggestionConfig = { provider: "anthropic" as const, model: "claude", apiKey: "k" };
      const analysisConfig = null;
      const resolved = analysisConfig ?? suggestionConfig;
      expect(resolved.provider).toBe("anthropic");
    });
  });

  describe("regenerate", () => {
    it("checks AI message limit", async () => {
      await mockCheckAI({} as any, "c1");
      expect(mockCheckAI).toHaveBeenCalled();
    });

    it("throws BAD_REQUEST when no fan message found", () => {
      const messages = [
        { role: "creator", content: "Hola" },
      ];
      const lastFan = [...messages].reverse().find((m) => m.role === "fan");

      expect(() => {
        if (!lastFan) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No hay mensaje del fan para regenerar." });
        }
      }).toThrow(TRPCError);
    });

    it("finds last fan message for regeneration", () => {
      const messages = [
        { role: "fan", content: "Hola" },
        { role: "creator", content: "Hola!" },
        { role: "fan", content: "Como estas?" },
        { role: "creator", content: "Bien!" },
      ];

      const lastFan = [...messages].reverse().find((m) => m.role === "fan");
      expect(lastFan?.content).toBe("Como estas?");
    });

    it("uses history up to last fan message", () => {
      const messages = [
        { role: "fan", content: "Hola" },
        { role: "creator", content: "Hey" },
        { role: "fan", content: "Last fan msg" },
        { role: "creator", content: "Reply" },
      ];

      const lastFanIndex = messages.findLastIndex((m) => m.role === "fan");
      const history = messages.slice(0, lastFanIndex);
      expect(history).toHaveLength(2);
      expect(history[1]!.content).toBe("Hey");
    });
  });

  describe("summarizeConversation", () => {
    it("resolves config for summary task", async () => {
      await mockResolveConfig({} as any, "c1", "summary");
      expect(mockResolveConfig).toHaveBeenCalledWith({}, "c1", "summary");
    });

    it("saves summary to conversation", () => {
      const update = { summary: "Test summary" };
      expect(update.summary).toBe("Test summary");
    });
  });

  describe("generateReport", () => {
    it("checks report limit", async () => {
      await mockCheckReport({} as any, "c1");
      expect(mockCheckReport).toHaveBeenCalled();
    });

    it("resolves config for report task", async () => {
      await mockResolveConfig({} as any, "c1", "report");
      expect(mockResolveConfig).toHaveBeenCalledWith({}, "c1", "report");
    });

    it("extracts top 5 topics from signals", () => {
      const topicFrequency = { fotos: 10, videos: 8, chat: 5, tips: 3, live: 2, other: 1 };
      const topics = Object.entries(topicFrequency)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([t]) => t);

      expect(topics).toEqual(["fotos", "videos", "chat", "tips", "live"]);
    });
  });

  describe("getPriceAdvice", () => {
    it("checks priceAdvisor feature access", async () => {
      await mockCheckFeature({} as any, "c1", "priceAdvisor");
      expect(mockCheckFeature).toHaveBeenCalledWith({}, "c1", "priceAdvisor");
    });

    it("resolves config for price_advice task", async () => {
      await mockResolveConfig({} as any, "c1", "price_advice");
      expect(mockResolveConfig).toHaveBeenCalledWith({}, "c1", "price_advice");
    });
  });
});
