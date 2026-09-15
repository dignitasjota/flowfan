import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  MODEL_REGISTRY,
  isReasonerModel,
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

  describe("ARCH-3: stopReason normalization", () => {
    it("normalizes Anthropic's stop_reason=max_tokens to 'length'", async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "cut off" }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: "max_tokens",
      });

      const result = await callAIProvider(
        { provider: "anthropic", model: "claude-sonnet-4-6", apiKey: "k" },
        "sys",
        [{ role: "user", content: "hi" }]
      );

      expect(result.stopReason).toBe("length");
    });

    it("normalizes Anthropic's stop_reason=end_turn to 'stop'", async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "done" }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: "end_turn",
      });

      const result = await callAIProvider(
        { provider: "anthropic", model: "claude-sonnet-4-6", apiKey: "k" },
        "sys",
        [{ role: "user", content: "hi" }]
      );

      expect(result.stopReason).toBe("stop");
    });

    it("normalizes OpenAI's finish_reason=length to 'length'", async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{ message: { content: "cut off" }, finish_reason: "length" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const result = await callAIProvider(
        { provider: "openai", model: "gpt-4o", apiKey: "k" },
        "sys",
        [{ role: "user", content: "hi" }]
      );

      expect(result.stopReason).toBe("length");
    });
  });

  describe("ARCH-11: reasoner min budget", () => {
    it("bumps maxTokens for a reasoner model (MiniMax-M1) when the caller asked for less", async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      await callAIProvider(
        { provider: "minimax", model: "MiniMax-M1", apiKey: "k" },
        "sys",
        [{ role: "user", content: "hi" }],
        100 // el classifier real pide esto — se truncaría sin el bump
      );

      expect(mockOpenAICreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 2000 })
      );
    });

    it("does NOT bump maxTokens for a non-reasoner model", async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      await callAIProvider(
        { provider: "minimax", model: "minimax-m2.5", apiKey: "k" },
        "sys",
        [{ role: "user", content: "hi" }],
        100
      );

      expect(mockOpenAICreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 100 })
      );
    });
  });

  describe("ARCH-3: Google provider (fetch-based, retry on 429/5xx)", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("succeeds on the first try and normalizes finishReason", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "hola" }] }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        }),
      });
      global.fetch = mockFetch as any;

      const result = await callAIProvider(
        { provider: "google", model: "gemini-2.5-flash", apiKey: "k" },
        "sys",
        [{ role: "user", content: "hi" }]
      );

      expect(result.text).toBe("hola");
      expect(result.stopReason).toBe("stop");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("retries on a 503 and succeeds on the second attempt", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "overloaded" })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "hola" }] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          }),
        });
      global.fetch = mockFetch as any;

      const result = await callAIProvider(
        { provider: "google", model: "gemini-2.5-flash", apiKey: "k" },
        "sys",
        [{ role: "user", content: "hi" }]
      );

      expect(result.text).toBe("hola");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry on a 400 (non-retryable) and throws immediately", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => "bad request",
      });
      global.fetch = mockFetch as any;

      await expect(
        callAIProvider(
          { provider: "google", model: "gemini-2.5-flash", apiKey: "k" },
          "sys",
          [{ role: "user", content: "hi" }]
        )
      ).rejects.toThrow("Google AI error (400)");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("gives up after exhausting retries on persistent 429s", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "rate limited",
      });
      global.fetch = mockFetch as any;

      await expect(
        callAIProvider(
          { provider: "google", model: "gemini-2.5-flash", apiKey: "k" },
          "sys",
          [{ role: "user", content: "hi" }]
        )
      ).rejects.toThrow("Google AI error (429)");
      // 1 intento inicial + 2 reintentos = 3 llamadas
      expect(mockFetch).toHaveBeenCalledTimes(3);
    }, 10_000);
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

  it("AI-4: elimina un <think> sin cerrar (respuesta truncada)", () => {
    // Un modelo razonador truncado deja el bloque abierto; debe quedar vacío
    // en vez de dejar basura que rompe el parser JSON.
    expect(stripThinkingBlocks("<think>razonando y me corto")).toBe("");
    // Texto antes del <think> truncado se conserva.
    expect(stripThinkingBlocks("Output<think>truncado...")).toBe("Output");
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

  it("ARCH-5: marks the stable prefix with cache_control for Anthropic, and keeps the contact-specific part uncached", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "[CASUAL] hola" }],
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    await generateSuggestion(
      { provider: "anthropic", model: "claude-sonnet-4-6", apiKey: "test-key" },
      {
        platformType: "instagram",
        personality: { tone: "friendly" },
        globalInstructions: "Nunca prometas descuentos.",
        contactProfile: { engagementLevel: 80, funnelStage: "vip", communicationStyle: {}, paymentProbability: 90 },
        conversationHistory: [],
        contactNotes: ["Le gustan los gatos"],
        fanMessage: "Hola!",
      }
    );

    const callArgs = mockAnthropicCreate.mock.calls[0]![0];
    expect(Array.isArray(callArgs.system)).toBe(true);
    const [stableBlock, restBlock] = callArgs.system;
    expect(stableBlock.cache_control).toEqual({ type: "ephemeral" });
    expect(stableBlock.text).toContain("INSTRUCCIONES GLOBALES");
    expect(stableBlock.text).not.toContain("PERFIL DEL CONTACTO");
    expect(restBlock.cache_control).toBeUndefined();
    expect(restBlock.text).toContain("PERFIL DEL CONTACTO");
    expect(restBlock.text).toContain("Le gustan los gatos");
  });

  it("ARCH-5: does not touch the request shape for non-Anthropic providers (flattened string)", async () => {
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [{ message: { content: "[CASUAL] hola" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 50, completion_tokens: 10 },
    });

    await generateSuggestion(
      { provider: "openai", model: "gpt-4o", apiKey: "test-key" },
      {
        platformType: "instagram",
        personality: {},
        contactProfile: { engagementLevel: 10, funnelStage: "cold", communicationStyle: {}, paymentProbability: 5 },
        conversationHistory: [],
        contactNotes: [],
        fanMessage: "Hola",
      }
    );

    const callArgs = mockOpenAICreate.mock.calls[0]![0];
    const systemMessage = callArgs.messages[0];
    expect(systemMessage.role).toBe("system");
    expect(typeof systemMessage.content).toBe("string");
    expect(systemMessage.content).toContain("PERFIL DEL CONTACTO");
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

  it("is derived from MODEL_REGISTRY (same values, without the metadata)", () => {
    for (const [provider, models] of Object.entries(MODEL_REGISTRY)) {
      expect(PROVIDER_MODELS[provider as keyof typeof PROVIDER_MODELS]).toEqual(
        models.map(({ value, label }) => ({ value, label }))
      );
    }
  });
});

describe("ARCH-11: MODEL_REGISTRY / isReasonerModel", () => {
  it("every model has a positive contextWindow", () => {
    for (const models of Object.values(MODEL_REGISTRY)) {
      for (const model of models) {
        expect(model.contextWindow).toBeGreaterThan(0);
      }
    }
  });

  it("flags MiniMax-M1 as a reasoner", () => {
    expect(isReasonerModel("minimax", "MiniMax-M1")).toBe(true);
  });

  it("does not flag a regular chat model as a reasoner", () => {
    expect(isReasonerModel("minimax", "minimax-m2.5")).toBe(false);
    expect(isReasonerModel("anthropic", "claude-sonnet-4-6")).toBe(false);
  });

  it("defaults to false for an unknown model string", () => {
    expect(isReasonerModel("anthropic", "some-future-model")).toBe(false);
  });
});
