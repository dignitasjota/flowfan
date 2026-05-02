import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/services/ai", () => ({
  callAIProvider: vi.fn(),
  stripThinkingBlocks: (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
}));

vi.mock("@/server/services/language-utils", () => ({
  getLanguageInstruction: vi.fn((code: string) => `IDIOMA: Responde en ${code}`),
}));

import { generateCoaching } from "@/server/services/negotiation-coach";
import { callAIProvider } from "@/server/services/ai";
import { getLanguageInstruction } from "@/server/services/language-utils";

const mockCallAI = vi.mocked(callAIProvider);
const mockGetLang = vi.mocked(getLanguageInstruction);

const config = { provider: "anthropic" as const, model: "claude-sonnet-4-20250514", apiKey: "test-key" };

const baseInput = {
  coachingType: "negotiation" as const,
  platformType: "onlyfans",
  funnelStage: "hot_lead",
  engagementLevel: 75,
  paymentProbability: 60,
  conversationHistory: [
    { role: "fan" as const, content: "Me encanta tu contenido" },
    { role: "creator" as const, content: "Gracias! Tengo cosas exclusivas" },
  ],
};

const validResponse = {
  situationAssessment: "El fan muestra interes genuino en contenido exclusivo.",
  fanProfile: "Fan comprometido con alta disposicion a pagar.",
  currentLeverage: "El fan ya ha expresado interes en exclusividad.",
  risks: ["Presionar demasiado rapido", "Parecer transaccional"],
  tactics: [
    {
      name: "Escasez suave",
      description: "Mencionar que el contenido es limitado.",
      example: "Solo comparto esto con fans especiales como tu.",
      riskLevel: "low",
    },
    {
      name: "Anclaje de valor",
      description: "Contextualizar el precio con el valor recibido.",
      example: "Esto normalmente vale mucho mas, pero para ti...",
      riskLevel: "medium",
    },
    {
      name: "Cierre directo",
      description: "Pedir la venta directamente.",
      example: "Te lo envio ahora por $25?",
      riskLevel: "high",
    },
  ],
  suggestedNextMove: "Presentar oferta con framing de exclusividad.",
  avoidList: ["No mencionar precios sin contexto", "No ser agresivo"],
};

beforeEach(() => {
  mockCallAI.mockReset();
  mockGetLang.mockClear();
});

describe("generateCoaching", () => {
  it("returns parsed result for negotiation type", async () => {
    mockCallAI.mockResolvedValueOnce({ text: JSON.stringify(validResponse), tokensUsed: 500 });

    const result = await generateCoaching(config, baseInput);

    expect(result.situationAssessment).toBe(validResponse.situationAssessment);
    expect(result.fanProfile).toBe(validResponse.fanProfile);
    expect(result.currentLeverage).toBe(validResponse.currentLeverage);
    expect(result.suggestedNextMove).toBe(validResponse.suggestedNextMove);
    expect(result.tokensUsed).toBe(500);
  });

  it("returns parsed result for retention type", async () => {
    mockCallAI.mockResolvedValueOnce({ text: JSON.stringify(validResponse), tokensUsed: 300 });

    const result = await generateCoaching(config, { ...baseInput, coachingType: "retention" });

    expect(result.situationAssessment).toBe(validResponse.situationAssessment);
    expect(result.tokensUsed).toBe(300);

    const systemPrompt = mockCallAI.mock.calls[0]![1] as string;
    expect(systemPrompt).toContain("retencion de fans");
  });

  it("returns parsed result for upsell type", async () => {
    mockCallAI.mockResolvedValueOnce({ text: JSON.stringify(validResponse), tokensUsed: 400 });

    const result = await generateCoaching(config, { ...baseInput, coachingType: "upsell" });

    expect(result.situationAssessment).toBe(validResponse.situationAssessment);
    expect(result.tokensUsed).toBe(400);

    const systemPrompt = mockCallAI.mock.calls[0]![1] as string;
    expect(systemPrompt).toContain("upselling");
  });

  it("includes language instruction when language is set", async () => {
    mockCallAI.mockResolvedValueOnce({ text: JSON.stringify(validResponse), tokensUsed: 200 });

    await generateCoaching(config, { ...baseInput, language: "en" });

    expect(mockGetLang).toHaveBeenCalledWith("en");
    const systemPrompt = mockCallAI.mock.calls[0]![1] as string;
    expect(systemPrompt).toContain("IDIOMA: Responde en en");
  });

  it("does not include language instruction when language is not set", async () => {
    mockCallAI.mockResolvedValueOnce({ text: JSON.stringify(validResponse), tokensUsed: 200 });

    await generateCoaching(config, baseInput);

    expect(mockGetLang).not.toHaveBeenCalled();
  });

  it("returns fallback when AI returns invalid JSON", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "esto no es json valido", tokensUsed: 100 });

    const result = await generateCoaching(config, baseInput);

    expect(result.situationAssessment).toBe("No se pudo generar el analisis.");
    expect(result.fanProfile).toBe("No disponible");
    expect(result.currentLeverage).toBe("No disponible");
    expect(result.risks).toEqual([]);
    expect(result.tactics).toEqual([]);
    expect(result.suggestedNextMove).toBe("Continuar la conversacion naturalmente");
    expect(result.avoidList).toEqual([]);
    expect(result.tokensUsed).toBe(100);
  });

  it("parses JSON wrapped in markdown code blocks", async () => {
    const wrapped = "```json\n" + JSON.stringify(validResponse) + "\n```";
    mockCallAI.mockResolvedValueOnce({ text: wrapped, tokensUsed: 350 });

    const result = await generateCoaching(config, baseInput);

    expect(result.situationAssessment).toBe(validResponse.situationAssessment);
    expect(result.tactics).toHaveLength(3);
  });

  it("strips thinking blocks before parsing", async () => {
    const withThinking = "<think>internal reasoning</think>" + JSON.stringify(validResponse);
    mockCallAI.mockResolvedValueOnce({ text: withThinking, tokensUsed: 450 });

    const result = await generateCoaching(config, baseInput);

    expect(result.situationAssessment).toBe(validResponse.situationAssessment);
  });

  it("correctly structures tactics with valid risk levels", async () => {
    mockCallAI.mockResolvedValueOnce({ text: JSON.stringify(validResponse), tokensUsed: 500 });

    const result = await generateCoaching(config, baseInput);

    expect(result.tactics).toHaveLength(3);
    expect(result.tactics[0]!.name).toBe("Escasez suave");
    expect(result.tactics[0]!.riskLevel).toBe("low");
    expect(result.tactics[1]!.riskLevel).toBe("medium");
    expect(result.tactics[2]!.riskLevel).toBe("high");
  });

  it("defaults invalid riskLevel to medium", async () => {
    const modified = {
      ...validResponse,
      tactics: [{ name: "t", description: "d", example: "e", riskLevel: "extreme" }],
    };
    mockCallAI.mockResolvedValueOnce({ text: JSON.stringify(modified), tokensUsed: 200 });

    const result = await generateCoaching(config, baseInput);

    expect(result.tactics[0]!.riskLevel).toBe("medium");
  });

  it("forwards token usage from AI provider", async () => {
    mockCallAI.mockResolvedValueOnce({ text: JSON.stringify(validResponse), tokensUsed: 1234 });

    const result = await generateCoaching(config, baseInput);

    expect(result.tokensUsed).toBe(1234);
  });

  it("passes conversation history in user message", async () => {
    mockCallAI.mockResolvedValueOnce({ text: JSON.stringify(validResponse), tokensUsed: 200 });

    await generateCoaching(config, baseInput);

    const messages = mockCallAI.mock.calls[0]![2] as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toContain("Fan: Me encanta tu contenido");
    expect(messages[0]!.content).toContain("Creador: Gracias! Tengo cosas exclusivas");
    expect(messages[0]!.content).toContain("Engagement: 75/100");
    expect(messages[0]!.content).toContain("Probabilidad de pago: 60%");
  });
});
