import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the AI provider before importing the module
vi.mock("@/server/services/ai", () => ({
  callAIProvider: vi.fn(),
  stripThinkingBlocks: (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
}));

import { analyzeMessage } from "@/server/services/ai-analysis";
import { callAIProvider } from "@/server/services/ai";

const mockCallAI = vi.mocked(callAIProvider);

const config = { provider: "anthropic" as const, model: "claude-sonnet-4-20250514", apiKey: "test-key" };

beforeEach(() => {
  mockCallAI.mockReset();
});

describe("analyzeMessage", () => {
  describe("successful parsing", () => {
    it("parses a valid JSON response", async () => {
      mockCallAI.mockResolvedValueOnce({
        text: JSON.stringify({
          score: 0.7,
          label: "positive",
          emotionalTone: "entusiasta",
          topics: ["fotos", "contenido"],
          purchaseIntent: 0.5,
          budgetMentions: ["$20"],
          keyPhrases: ["me encanta tu contenido"],
        }),
        tokensUsed: 150,
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      });

      const result = await analyzeMessage(config, { message: "Me encanta tu contenido!" });

      expect(result.score).toBe(0.7);
      expect(result.label).toBe("positive");
      expect(result.emotionalTone).toBe("entusiasta");
      expect(result.topics).toEqual(["fotos", "contenido"]);
      expect(result.purchaseIntent).toBe(0.5);
      expect(result.budgetMentions).toEqual(["$20"]);
      expect(result.tokensUsed).toBe(150);
    });

    it("parses JSON wrapped in markdown code fences", async () => {
      mockCallAI.mockResolvedValueOnce({
        text: "```json\n" + JSON.stringify({
          score: 0.3,
          label: "neutral",
          emotionalTone: "casual",
          topics: [],
          purchaseIntent: 0,
          budgetMentions: [],
          keyPhrases: [],
        }) + "\n```",
        tokensUsed: 100,
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      });

      const result = await analyzeMessage(config, { message: "Hola" });
      expect(result.label).toBe("neutral");
      expect(result.score).toBe(0.3);
    });

    it("strips thinking blocks before parsing", async () => {
      mockCallAI.mockResolvedValueOnce({
        text: "<think>Let me analyze...</think>" + JSON.stringify({
          score: -0.5,
          label: "negative",
          emotionalTone: "frustrado",
          topics: ["queja"],
          purchaseIntent: 0,
          budgetMentions: [],
          keyPhrases: ["no me gusta"],
        }),
        tokensUsed: 120,
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      });

      const result = await analyzeMessage(config, { message: "No me gusta esto" });
      expect(result.label).toBe("negative");
      expect(result.score).toBe(-0.5);
    });
  });

  describe("value clamping", () => {
    it("clamps score to [-1, 1]", async () => {
      mockCallAI.mockResolvedValueOnce({
        text: JSON.stringify({ score: 5, label: "positive", emotionalTone: "test", topics: [], purchaseIntent: 0, budgetMentions: [], keyPhrases: [] }),
        tokensUsed: 50,
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      });

      const result = await analyzeMessage(config, { message: "test" });
      expect(result.score).toBe(1);
    });

    it("clamps negative score to -1", async () => {
      mockCallAI.mockResolvedValueOnce({
        text: JSON.stringify({ score: -10, label: "very_negative", emotionalTone: "test", topics: [], purchaseIntent: 0, budgetMentions: [], keyPhrases: [] }),
        tokensUsed: 50,
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      });

      const result = await analyzeMessage(config, { message: "test" });
      expect(result.score).toBe(-1);
    });

    it("clamps purchaseIntent to [0, 1]", async () => {
      mockCallAI.mockResolvedValueOnce({
        text: JSON.stringify({ score: 0, label: "neutral", emotionalTone: "test", topics: [], purchaseIntent: 2.5, budgetMentions: [], keyPhrases: [] }),
        tokensUsed: 50,
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      });

      const result = await analyzeMessage(config, { message: "test" });
      expect(result.purchaseIntent).toBe(1);
    });

    it("limits topics to 5", async () => {
      mockCallAI.mockResolvedValueOnce({
        text: JSON.stringify({ score: 0, label: "neutral", emotionalTone: "test", topics: ["a", "b", "c", "d", "e", "f", "g"], purchaseIntent: 0, budgetMentions: [], keyPhrases: [] }),
        tokensUsed: 50,
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      });

      const result = await analyzeMessage(config, { message: "test" });
      expect(result.topics).toHaveLength(5);
    });

    it("limits keyPhrases to 5", async () => {
      mockCallAI.mockResolvedValueOnce({
        text: JSON.stringify({ score: 0, label: "neutral", emotionalTone: "test", topics: [], purchaseIntent: 0, budgetMentions: [], keyPhrases: ["a", "b", "c", "d", "e", "f"] }),
        tokensUsed: 50,
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      });

      const result = await analyzeMessage(config, { message: "test" });
      expect(result.keyPhrases).toHaveLength(5);
    });
  });

  describe("invalid label handling", () => {
    it("defaults to neutral for unknown label", async () => {
      mockCallAI.mockResolvedValueOnce({
        text: JSON.stringify({ score: 0.5, label: "amazing", emotionalTone: "test", topics: [], purchaseIntent: 0, budgetMentions: [], keyPhrases: [] }),
        tokensUsed: 50,
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      });

      const result = await analyzeMessage(config, { message: "test" });
      expect(result.label).toBe("neutral");
    });
  });

  describe("non-array fields", () => {
    it("converts non-array topics to empty array", async () => {
      mockCallAI.mockResolvedValueOnce({
        text: JSON.stringify({ score: 0, label: "neutral", emotionalTone: "test", topics: "not-array", purchaseIntent: 0, budgetMentions: "also-not-array", keyPhrases: 123 }),
        tokensUsed: 50,
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      });

      const result = await analyzeMessage(config, { message: "test" });
      expect(result.topics).toEqual([]);
      expect(result.budgetMentions).toEqual([]);
      expect(result.keyPhrases).toEqual([]);
    });
  });

  describe("fallback behavior", () => {
    it("returns neutral on invalid JSON", async () => {
      mockCallAI.mockResolvedValueOnce({
        text: "This is not JSON at all, just random text.",
        tokensUsed: 80,
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      });

      const result = await analyzeMessage(config, { message: "test" });
      expect(result.score).toBe(0);
      expect(result.label).toBe("neutral");
      expect(result.emotionalTone).toBe("indeterminado");
      expect(result.topics).toEqual([]);
      expect(result.purchaseIntent).toBe(0);
      expect(result.tokensUsed).toBe(80);
    });

    it("returns neutral on empty AI response", async () => {
      mockCallAI.mockResolvedValueOnce({
        text: "",
        tokensUsed: 10,
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      });

      const result = await analyzeMessage(config, { message: "test" });
      expect(result.label).toBe("neutral");
    });

    it("returns neutral on malformed JSON", async () => {
      mockCallAI.mockResolvedValueOnce({
        text: '{"score": 0.5, "label": "positive", broken json here',
        tokensUsed: 50,
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      });

      const result = await analyzeMessage(config, { message: "test" });
      expect(result.label).toBe("neutral");
    });
  });

  describe("conversation history", () => {
    it("includes conversation context in AI call", async () => {
      mockCallAI.mockResolvedValueOnce({
        text: JSON.stringify({ score: 0, label: "neutral", emotionalTone: "test", topics: [], purchaseIntent: 0, budgetMentions: [], keyPhrases: [] }),
        tokensUsed: 50,
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      });

      await analyzeMessage(config, {
        message: "Quiero comprar",
        conversationHistory: [
          { role: "fan", content: "Hola" },
          { role: "creator", content: "Hola! Que tal?" },
        ],
      });

      expect(mockCallAI).toHaveBeenCalledWith(
        config,
        expect.any(String),
        expect.arrayContaining([
          { role: "user", content: "Hola" },
          { role: "assistant", content: "Hola! Que tal?" },
        ]),
        512
      );
    });

    it("limits history to last 5 messages", async () => {
      mockCallAI.mockResolvedValueOnce({
        text: JSON.stringify({ score: 0, label: "neutral", emotionalTone: "test", topics: [], purchaseIntent: 0, budgetMentions: [], keyPhrases: [] }),
        tokensUsed: 50,
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      });

      const history = Array.from({ length: 10 }, (_, i) => ({
        role: (i % 2 === 0 ? "fan" : "creator") as "fan" | "creator",
        content: `Message ${i}`,
      }));

      await analyzeMessage(config, { message: "test", conversationHistory: history });

      const callArgs = mockCallAI.mock.calls[0]!;
      // 5 history + 1 analysis message = 6
      expect(callArgs[2]).toHaveLength(6);
    });
  });
});
