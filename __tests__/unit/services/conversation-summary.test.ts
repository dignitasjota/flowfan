import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/services/ai", () => ({
  callAIProvider: vi.fn(),
  stripThinkingBlocks: (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
}));

import { summarizeConversation } from "@/server/services/conversation-summary";
import { callAIProvider } from "@/server/services/ai";

const mockCallAI = vi.mocked(callAIProvider);
const config = { provider: "anthropic" as const, model: "claude-sonnet-4-20250514", apiKey: "test-key" };

const baseInput = {
  platformType: "instagram",
  contactUsername: "fan123",
  funnelStage: "curious",
  messages: [
    { role: "fan" as const, content: "Hola!" },
    { role: "creator" as const, content: "Hola, como estas?" },
    { role: "fan" as const, content: "Bien! Me encanta tu contenido" },
  ],
};

beforeEach(() => {
  mockCallAI.mockReset();
});

describe("summarizeConversation", () => {
  it("parses valid JSON response", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Conversacion positiva sobre contenido",
        mainTopic: "Contenido",
        relationshipStatus: "en desarrollo",
        nextSteps: ["Ofrecer contenido exclusivo"],
      }),
      tokensUsed: 200,
    });

    const result = await summarizeConversation(config, baseInput);
    expect(result.summary).toBe("Conversacion positiva sobre contenido");
    expect(result.mainTopic).toBe("Contenido");
    expect(result.relationshipStatus).toBe("en desarrollo");
    expect(result.nextSteps).toEqual(["Ofrecer contenido exclusivo"]);
    expect(result.tokensUsed).toBe(200);
  });

  it("handles markdown code fences", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: "```json\n" + JSON.stringify({
        summary: "Resumen",
        mainTopic: "General",
        relationshipStatus: "inicial",
        nextSteps: [],
      }) + "\n```",
      tokensUsed: 100,
    });

    const result = await summarizeConversation(config, baseInput);
    expect(result.summary).toBe("Resumen");
  });

  it("handles thinking blocks", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: "<think>Analyzing...</think>" + JSON.stringify({
        summary: "Test summary",
        mainTopic: "Test",
        relationshipStatus: "solida",
        nextSteps: ["Paso 1"],
      }),
      tokensUsed: 150,
    });

    const result = await summarizeConversation(config, baseInput);
    expect(result.summary).toBe("Test summary");
  });

  it("limits nextSteps to 3", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "s",
        mainTopic: "t",
        relationshipStatus: "inicial",
        nextSteps: ["a", "b", "c", "d", "e"],
      }),
      tokensUsed: 50,
    });

    const result = await summarizeConversation(config, baseInput);
    expect(result.nextSteps).toHaveLength(3);
  });

  it("returns fallback on invalid JSON", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: "This is not valid JSON at all",
      tokensUsed: 80,
    });

    const result = await summarizeConversation(config, baseInput);
    expect(result.summary).toBe("No se pudo generar el resumen.");
    expect(result.mainTopic).toBe("Desconocido");
    expect(result.relationshipStatus).toBe("inicial");
    expect(result.nextSteps).toEqual([]);
    expect(result.tokensUsed).toBe(80);
  });

  it("returns fallback on empty response", async () => {
    mockCallAI.mockResolvedValueOnce({ text: "", tokensUsed: 10 });

    const result = await summarizeConversation(config, baseInput);
    expect(result.summary).toBe("No se pudo generar el resumen.");
  });

  it("handles missing fields with defaults", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({}),
      tokensUsed: 50,
    });

    const result = await summarizeConversation(config, baseInput);
    expect(result.summary).toBe("Sin resumen disponible");
    expect(result.mainTopic).toBe("General");
    expect(result.nextSteps).toEqual([]);
  });

  it("converts non-array nextSteps to empty array", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "s",
        mainTopic: "t",
        relationshipStatus: "r",
        nextSteps: "not an array",
      }),
      tokensUsed: 50,
    });

    const result = await summarizeConversation(config, baseInput);
    expect(result.nextSteps).toEqual([]);
  });

  it("passes correct context to AI provider", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "s",
        mainTopic: "t",
        relationshipStatus: "r",
        nextSteps: [],
      }),
      tokensUsed: 50,
    });

    await summarizeConversation(config, baseInput);

    expect(mockCallAI).toHaveBeenCalledWith(
      config,
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("fan123"),
        }),
      ]),
      512
    );
  });

  it("limits messages to last 30", async () => {
    const manyMessages = Array.from({ length: 40 }, (_, i) => ({
      role: (i % 2 === 0 ? "fan" : "creator") as "fan" | "creator",
      content: `Message ${i}`,
    }));

    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "s",
        mainTopic: "t",
        relationshipStatus: "r",
        nextSteps: [],
      }),
      tokensUsed: 50,
    });

    await summarizeConversation(config, { ...baseInput, messages: manyMessages });

    const callContent = mockCallAI.mock.calls[0]![2][0]!.content;
    // Should contain messages 10-39 (last 30), not 0-9
    expect(callContent).not.toContain("Message 0:");
  });
});
