import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the actual SDK clients
const mockAnthropicCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockAnthropicCreate };
      constructor(_opts: any) {}
    },
  };
});

const mockOpenAICreate = vi.fn();
vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = { completions: { create: mockOpenAICreate } };
      constructor(_opts: any) {}
    },
  };
});

import {
  callAIProvider,
  generateSuggestion,
  stripThinkingBlocks,
  PROVIDER_MODELS,
} from "@/server/services/ai";
import type { SuggestionInput } from "@/server/services/ai";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("callAIProvider", () => {
  describe("Anthropic provider", () => {
    it("calls Anthropic API correctly", async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "Hola!" }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const result = await callAIProvider(
        { provider: "anthropic", model: "claude-sonnet-4-20250514", apiKey: "test-key" },
        "System prompt",
        [{ role: "user", content: "Hello" }],
        512
      );

      expect(result.text).toBe("Hola!");
      expect(result.tokensUsed).toBe(150);
    });

    it("handles empty content", async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: "image", text: "" }],
        usage: { input_tokens: 10, output_tokens: 0 },
      });

      const result = await callAIProvider(
        { provider: "anthropic", model: "claude-sonnet-4-20250514", apiKey: "test-key" },
        "System",
        [{ role: "user", content: "Hello" }]
      );

      expect(result.text).toBe("");
    });
  });

  describe("OpenAI provider", () => {
    it("calls OpenAI API correctly", async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{ message: { content: "Response" } }],
        usage: { prompt_tokens: 80, completion_tokens: 40 },
      });

      const result = await callAIProvider(
        { provider: "openai", model: "gpt-4o", apiKey: "test-key" },
        "System prompt",
        [{ role: "user", content: "Hello" }],
        1024
      );

      expect(result.text).toBe("Response");
      expect(result.tokensUsed).toBe(120);
    });
  });

  it("throws for unsupported provider", async () => {
    await expect(
      callAIProvider(
        { provider: "unknown" as any, model: "m", apiKey: "k" },
        "sys",
        [{ role: "user", content: "hi" }]
      )
    ).rejects.toThrow("Unsupported AI provider");
  });
});

describe("stripThinkingBlocks", () => {
  it("removes thinking blocks", () => {
    expect(stripThinkingBlocks("<think>internal</think>Result")).toBe("Result");
  });

  it("removes multiple thinking blocks", () => {
    expect(
      stripThinkingBlocks("<think>a</think>text<think>b</think>more")
    ).toBe("textmore");
  });

  it("handles no thinking blocks", () => {
    expect(stripThinkingBlocks("Just text")).toBe("Just text");
  });

  it("handles multiline thinking", () => {
    expect(
      stripThinkingBlocks("<think>\nLine 1\nLine 2\n</think>Output")
    ).toBe("Output");
  });
});

describe("generateSuggestion", () => {
  it("returns suggestions and variants", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{
        type: "text",
        text: "[CASUAL] Hola que tal!\n---\n[SALES] Te interesa mi contenido?\n---\n[RETENTION] Me alegra verte!",
      }],
      usage: { input_tokens: 200, output_tokens: 100 },
    });

    const input: SuggestionInput = {
      platformType: "instagram",
      personality: { tone: "friendly" },
      contactProfile: null,
      conversationHistory: [],
      contactNotes: [],
      fanMessage: "Hola!",
    };

    const result = await generateSuggestion(
      { provider: "anthropic", model: "claude-sonnet-4-20250514", apiKey: "test-key" },
      input
    );

    expect(result.suggestions).toHaveLength(3);
    expect(result.variants).toHaveLength(3);
    expect(result.variants[0]!.type).toBe("casual");
    expect(result.variants[1]!.type).toBe("sales");
    expect(result.variants[2]!.type).toBe("retention");
    expect(result.tokensUsed).toBe(300);
    expect(result.provider).toBe("anthropic");
  });

  it("handles response without variant tags", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Simple response without tags" }],
      usage: { input_tokens: 50, output_tokens: 20 },
    });

    const result = await generateSuggestion(
      { provider: "anthropic", model: "claude-sonnet-4-20250514", apiKey: "test-key" },
      {
        platformType: "instagram",
        personality: {},
        contactProfile: null,
        conversationHistory: [],
        contactNotes: [],
        fanMessage: "Hola",
      }
    );

    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(result.variants[0]!.type).toBe("casual"); // fallback type
  });
});

describe("PROVIDER_MODELS", () => {
  it("has models for all providers", () => {
    expect(PROVIDER_MODELS.anthropic.length).toBeGreaterThan(0);
    expect(PROVIDER_MODELS.openai.length).toBeGreaterThan(0);
    expect(PROVIDER_MODELS.google.length).toBeGreaterThan(0);
    expect(PROVIDER_MODELS.minimax.length).toBeGreaterThan(0);
    expect(PROVIDER_MODELS.kimi.length).toBeGreaterThan(0);
  });

  it("each model has value and label", () => {
    for (const provider of Object.values(PROVIDER_MODELS)) {
      for (const model of provider) {
        expect(model.value).toBeTruthy();
        expect(model.label).toBeTruthy();
      }
    }
  });
});
