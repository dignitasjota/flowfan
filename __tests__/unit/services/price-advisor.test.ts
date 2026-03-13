import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/services/ai", () => ({
  callAIProvider: vi.fn(),
  stripThinkingBlocks: (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
}));

import { getPriceAdvice } from "@/server/services/price-advisor";
import { callAIProvider } from "@/server/services/ai";

const mockCallAI = vi.mocked(callAIProvider);
const config = { provider: "anthropic" as const, model: "claude-sonnet-4-20250514", apiKey: "test-key" };

const baseInput = {
  platformType: "onlyfans",
  funnelStage: "hot_lead",
  paymentProbability: 65,
  estimatedBudget: "high",
  engagementLevel: 70,
  sentimentTrend: 0.2,
  topics: ["fotos", "videos"],
  recentMessages: [
    { role: "fan" as const, content: "Cuanto cuesta tu contenido exclusivo?" },
    { role: "creator" as const, content: "Te escribo por DM" },
  ],
};

beforeEach(() => {
  mockCallAI.mockReset();
});

describe("getPriceAdvice", () => {
  it("parses valid JSON response", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({
        recommendedPrice: 25,
        priceRange: { min: 15, max: 40 },
        confidence: 0.8,
        timing: "now",
        timingReason: "El fan esta preguntando activamente",
        strategy: "Ofrecer paquete de fotos exclusivas",
      }),
      tokensUsed: 250,
    });

    const result = await getPriceAdvice(config, baseInput);
    expect(result.recommendedPrice).toBe(25);
    expect(result.priceRange).toEqual({ min: 15, max: 40 });
    expect(result.confidence).toBe(0.8);
    expect(result.timing).toBe("now");
    expect(result.tokensUsed).toBe(250);
  });

  it("clamps confidence to 0-1", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({
        recommendedPrice: 10,
        priceRange: { min: 5, max: 20 },
        confidence: 1.5,
        timing: "now",
        timingReason: "r",
        strategy: "s",
      }),
      tokensUsed: 50,
    });

    const result = await getPriceAdvice(config, baseInput);
    expect(result.confidence).toBe(1);
  });

  it("clamps negative prices to 0", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({
        recommendedPrice: -10,
        priceRange: { min: -5, max: -1 },
        confidence: 0.5,
        timing: "wait",
        timingReason: "r",
        strategy: "s",
      }),
      tokensUsed: 50,
    });

    const result = await getPriceAdvice(config, baseInput);
    expect(result.recommendedPrice).toBe(0);
    expect(result.priceRange.min).toBe(0);
    expect(result.priceRange.max).toBe(0);
  });

  it("defaults invalid timing to wait", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({
        recommendedPrice: 10,
        priceRange: { min: 5, max: 20 },
        confidence: 0.5,
        timing: "immediately",
        timingReason: "r",
        strategy: "s",
      }),
      tokensUsed: 50,
    });

    const result = await getPriceAdvice(config, baseInput);
    expect(result.timing).toBe("wait");
  });

  it("returns fallback on invalid JSON", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: "I cannot provide pricing",
      tokensUsed: 80,
    });

    const result = await getPriceAdvice(config, baseInput);
    expect(result.recommendedPrice).toBe(0);
    expect(result.confidence).toBe(0);
    expect(result.timing).toBe("wait");
    expect(result.tokensUsed).toBe(80);
  });

  it("handles thinking blocks", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: "<think>analyzing...</think>" + JSON.stringify({
        recommendedPrice: 30,
        priceRange: { min: 20, max: 50 },
        confidence: 0.7,
        timing: "soon",
        timingReason: "Buen momento",
        strategy: "Oferta limitada",
      }),
      tokensUsed: 150,
    });

    const result = await getPriceAdvice(config, baseInput);
    expect(result.recommendedPrice).toBe(30);
    expect(result.timing).toBe("soon");
  });

  it("handles missing fields with defaults", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({}),
      tokensUsed: 50,
    });

    const result = await getPriceAdvice(config, baseInput);
    expect(result.recommendedPrice).toBe(0);
    expect(result.timingReason).toBe("Sin datos suficientes");
    expect(result.strategy).toBe("Necesita mas interaccion");
  });
});
