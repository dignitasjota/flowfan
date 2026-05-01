import { describe, it, expect, vi } from "vitest";

// ============================================================
// Helpers — test the keyword classifier directly
// ============================================================

// We import the module and test classifyMessage which uses keywords first
// For AI-dependent paths we mock callAIProvider

vi.mock("@/server/services/ai", () => ({
  callAIProvider: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { classifyMessage, type MessageCategory } from "@/server/services/message-classifier";
import { callAIProvider } from "@/server/services/ai";

const mockCallAI = vi.mocked(callAIProvider);

const dummyConfig = {
  provider: "openai" as const,
  model: "gpt-4o-mini",
  apiKey: "test-key",
};

// ============================================================
// Keyword classification
// ============================================================

describe("message-classifier — keywords", () => {
  it("classifies price inquiry keywords (Spanish)", async () => {
    const result = await classifyMessage(dummyConfig as never, "cuanto cobras por un ppv?", "onlyfans");
    expect(result.category).toBe("price_inquiry");
    expect(result.confidence).toBe(0.7);
  });

  it("classifies price inquiry keywords (English)", async () => {
    const result = await classifyMessage(dummyConfig as never, "how much do you charge?", "onlyfans");
    expect(result.category).toBe("price_inquiry");
    expect(result.confidence).toBe(0.7);
  });

  it("classifies urgent keywords", async () => {
    const result = await classifyMessage(dummyConfig as never, "necesito hablar contigo ahora", "instagram");
    expect(result.category).toBe("urgent");
    expect(result.confidence).toBe(0.7);
  });

  it("classifies spam with multiple URLs", async () => {
    const result = await classifyMessage(
      dummyConfig as never,
      "check https://spam.com and https://more-spam.com win free stuff",
      "instagram"
    );
    expect(result.category).toBe("spam");
    expect(result.confidence).toBe(0.7);
  });

  it("classifies spam keywords", async () => {
    const result = await classifyMessage(dummyConfig as never, "participas en el sorteo gratis!", "telegram");
    expect(result.category).toBe("spam");
    expect(result.confidence).toBe(0.7);
  });

  it("prefers price_inquiry over urgent when both match", async () => {
    const result = await classifyMessage(dummyConfig as never, "necesito saber el precio ahora", "onlyfans");
    expect(result.category).toBe("price_inquiry");
  });
});

// ============================================================
// AI classification fallback
// ============================================================

describe("message-classifier — AI fallback", () => {
  beforeEach(() => {
    mockCallAI.mockReset();
  });

  it("calls AI when no keywords match and returns AI result", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({ category: "urgent", confidence: 0.9 }),
      tokensUsed: 50,
    });

    const result = await classifyMessage(dummyConfig as never, "hola que tal todo", "instagram");
    expect(result.category).toBe("urgent");
    expect(result.confidence).toBe(0.9);
    expect(mockCallAI).toHaveBeenCalledOnce();
  });

  it("returns general with 0.5 confidence when AI fails", async () => {
    mockCallAI.mockRejectedValueOnce(new Error("API down"));

    const result = await classifyMessage(dummyConfig as never, "hola que tal", "instagram");
    expect(result.category).toBe("general");
    expect(result.confidence).toBe(0.5);
  });

  it("returns general when AI returns invalid category", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({ category: "unknown_cat", confidence: 0.8 }),
      tokensUsed: 50,
    });

    const result = await classifyMessage(dummyConfig as never, "hola", "instagram");
    expect(result.category).toBe("general");
    expect(result.confidence).toBe(0.5);
  });

  it("returns general when AI returns invalid JSON", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: "not json at all",
      tokensUsed: 50,
    });

    const result = await classifyMessage(dummyConfig as never, "hey", "instagram");
    expect(result.category).toBe("general");
    expect(result.confidence).toBe(0.5);
  });

  it("does NOT call AI when keywords match", async () => {
    await classifyMessage(dummyConfig as never, "cuanto cuesta?", "onlyfans");
    expect(mockCallAI).not.toHaveBeenCalled();
  });

  it("handles missing confidence in AI response", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({ category: "spam" }),
      tokensUsed: 30,
    });

    const result = await classifyMessage(dummyConfig as never, "mensaje random", "telegram");
    expect(result.category).toBe("spam");
    expect(result.confidence).toBe(0.5);
  });
});

// ============================================================
// Category validation
// ============================================================

describe("message-classifier — categories", () => {
  it("all valid categories are covered", () => {
    const validCategories: MessageCategory[] = ["urgent", "price_inquiry", "spam", "general"];
    expect(validCategories).toHaveLength(4);
  });
});
