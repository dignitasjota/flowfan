import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/services/ai", () => ({
  callAIProvider: vi.fn(),
  stripThinkingBlocks: (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
}));

import { generateContactReport } from "@/server/services/contact-report";
import { callAIProvider } from "@/server/services/ai";

const mockCallAI = vi.mocked(callAIProvider);
const config = { provider: "anthropic" as const, model: "claude-sonnet-4-20250514", apiKey: "test-key" };

const baseInput = {
  contactUsername: "fan_user",
  platformType: "onlyfans",
  funnelStage: "interested",
  engagementLevel: 65,
  paymentProbability: 45,
  estimatedBudget: "medium",
  totalConversations: 3,
  firstInteractionAt: "2024-01-15T00:00:00Z",
  topics: ["fotos", "videos"],
  sentimentAvg: 0.6,
  sentimentTrend: 0.1,
  messageCount: 25,
  recentMessages: [
    { role: "fan" as const, content: "Me encanta tu contenido" },
    { role: "creator" as const, content: "Gracias!" },
  ],
};

beforeEach(() => {
  mockCallAI.mockReset();
});

describe("generateContactReport", () => {
  it("parses valid JSON response", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({
        overview: "Fan muy activo con alto engagement",
        patterns: ["Escribe seguido", "Responde rapido"],
        interests: ["fotos", "videos exclusivos"],
        funnelPrediction: { nextStage: "hot_lead", probability: 70, timeframe: "1-2 semanas" },
        recommendations: ["Ofrecer contenido exclusivo"],
        riskLevel: "low",
        riskFactors: [],
      }),
      tokensUsed: 300,
    });

    const result = await generateContactReport(config, baseInput);
    expect(result.overview).toBe("Fan muy activo con alto engagement");
    expect(result.patterns).toHaveLength(2);
    expect(result.funnelPrediction.nextStage).toBe("hot_lead");
    expect(result.funnelPrediction.probability).toBe(70);
    expect(result.riskLevel).toBe("low");
    expect(result.tokensUsed).toBe(300);
  });

  it("clamps funnelPrediction.probability to 0-100", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({
        overview: "o",
        patterns: [],
        interests: [],
        funnelPrediction: { nextStage: "vip", probability: 150, timeframe: "now" },
        recommendations: [],
        riskLevel: "low",
        riskFactors: [],
      }),
      tokensUsed: 50,
    });

    const result = await generateContactReport(config, baseInput);
    expect(result.funnelPrediction.probability).toBe(100);
  });

  it("limits arrays to max sizes", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({
        overview: "o",
        patterns: ["a", "b", "c", "d", "e", "f", "g"],
        interests: ["1", "2", "3", "4", "5", "6", "7"],
        funnelPrediction: { nextStage: "hot_lead", probability: 50, timeframe: "1 week" },
        recommendations: ["r1", "r2", "r3", "r4", "r5", "r6"],
        riskLevel: "medium",
        riskFactors: ["f1", "f2", "f3", "f4"],
      }),
      tokensUsed: 50,
    });

    const result = await generateContactReport(config, baseInput);
    expect(result.patterns.length).toBeLessThanOrEqual(5);
    expect(result.interests.length).toBeLessThanOrEqual(5);
    expect(result.recommendations.length).toBeLessThanOrEqual(5);
    expect(result.riskFactors.length).toBeLessThanOrEqual(3);
  });

  it("defaults invalid riskLevel to medium", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({
        overview: "o",
        patterns: [],
        interests: [],
        funnelPrediction: { nextStage: "x", probability: 0, timeframe: "t" },
        recommendations: [],
        riskLevel: "extreme",
        riskFactors: [],
      }),
      tokensUsed: 50,
    });

    const result = await generateContactReport(config, baseInput);
    expect(result.riskLevel).toBe("medium");
  });

  it("returns fallback on invalid JSON", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: "Not JSON at all",
      tokensUsed: 100,
    });

    const result = await generateContactReport(config, baseInput);
    expect(result.overview).toBe("No se pudo generar el informe.");
    expect(result.patterns).toEqual([]);
    expect(result.riskLevel).toBe("medium");
    expect(result.tokensUsed).toBe(100);
  });

  it("handles markdown code fences", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: "```json\n" + JSON.stringify({
        overview: "Test",
        patterns: [],
        interests: [],
        funnelPrediction: { nextStage: "curious", probability: 30, timeframe: "2 weeks" },
        recommendations: [],
        riskLevel: "low",
        riskFactors: [],
      }) + "\n```",
      tokensUsed: 50,
    });

    const result = await generateContactReport(config, baseInput);
    expect(result.overview).toBe("Test");
  });

  it("handles missing nested fields with defaults", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({ overview: "o" }),
      tokensUsed: 50,
    });

    const result = await generateContactReport(config, baseInput);
    expect(result.funnelPrediction.nextStage).toBe("sin cambio");
    expect(result.funnelPrediction.probability).toBe(0);
    expect(result.funnelPrediction.timeframe).toBe("indeterminado");
  });
});
