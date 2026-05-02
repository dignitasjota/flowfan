import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================
// Mocks
// ============================================================

vi.mock("@/server/services/ai", () => ({
  callAIProvider: vi.fn(),
  stripThinkingBlocks: (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
}));

vi.mock("@/server/services/language-utils", () => ({
  getLanguageInstruction: vi.fn((lang: string) => `Responde en ${lang}.`),
}));

vi.mock("@/server/db/schema", () => ({
  contacts: { creatorId: "contacts.creatorId" },
  contactProfiles: {},
  messages: { conversationId: "messages.conversationId", createdAt: "messages.createdAt" },
  conversations: { id: "conversations.id", creatorId: "conversations.creatorId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  gte: vi.fn((...args: unknown[]) => ({ type: "gte", args })),
  count: vi.fn(() => "count"),
  sql: vi.fn(),
}));

import {
  aggregateConversationData,
  getTopicTrends,
  analyzeContentGaps,
  type AggregatedData,
} from "@/server/services/content-gap-analyzer";
import { callAIProvider } from "@/server/services/ai";
import { getLanguageInstruction } from "@/server/services/language-utils";

const mockCallAI = vi.mocked(callAIProvider);
const mockGetLang = vi.mocked(getLanguageInstruction);

// ============================================================
// Helpers
// ============================================================

const aiConfig = { provider: "anthropic" as const, model: "claude-sonnet-4-20250514", apiKey: "test-key" };

function makeContact(
  platformType: string,
  profile: {
    engagementLevel?: number;
    behavioralSignals?: Record<string, unknown>;
    scoringHistory?: Record<string, unknown>;
  } | null = null
) {
  return { platformType, profile };
}

function makeMockDb(contacts: unknown[] = [], msgCount = 0) {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ count: msgCount }]),
  };

  return {
    query: {
      contacts: {
        findMany: vi.fn().mockResolvedValue(contacts),
      },
    },
    select: vi.fn().mockReturnValue(selectChain),
  };
}

function makeValidAIResponse() {
  return {
    topRequestedTopics: [
      { topic: "fotos", frequency: 15, avgSentiment: 0.7, sampleQuotes: ["Me encantan las fotos"] },
    ],
    engagementDropPoints: [
      { pattern: "Despues de 7 dias sin respuesta", frequency: 5, suggestion: "Enviar mensaje de seguimiento" },
    ],
    contentOpportunities: [
      { title: "Videos detras de camaras", description: "Alta demanda", estimatedDemand: "high", estimatedRevenue: "medium" },
    ],
    platformBreakdown: [
      { platform: "onlyfans", topTopics: ["fotos", "videos"], avgEngagement: 72 },
    ],
    trendingThemes: ["exclusivo", "detras de camaras"],
    summary: "Los fans piden mas contenido exclusivo.",
  };
}

beforeEach(() => {
  mockCallAI.mockReset();
  mockGetLang.mockClear();
});

// ============================================================
// aggregateConversationData
// ============================================================

describe("aggregateConversationData", () => {
  it("aggregates topic frequencies and sentiments from contacts with data", async () => {
    const contacts = [
      makeContact("onlyfans", {
        engagementLevel: 80,
        behavioralSignals: {
          topicFrequency: { fotos: 5, videos: 3 },
          sentimentTrend: 0.6,
        },
      }),
      makeContact("onlyfans", {
        engagementLevel: 60,
        behavioralSignals: {
          topicFrequency: { fotos: 2, chat: 4 },
          sentimentTrend: -0.2,
        },
      }),
    ];
    const db = makeMockDb(contacts, 100);

    const result = await aggregateConversationData(db, "creator-1", 30);

    expect(result.topicFrequencies).toEqual({ fotos: 7, videos: 3, chat: 4 });
    expect(result.topicSentiments["fotos"]).toHaveLength(2);
    expect(result.topicSentiments["fotos"]).toEqual([0.6, -0.2]);
    expect(result.totalContacts).toBe(2);
    expect(result.totalMessages).toBe(100);
    expect(result.platformStats["onlyfans"]).toBeDefined();
    expect(result.platformStats["onlyfans"].contacts).toBe(2);
    expect(result.platformStats["onlyfans"].avgEngagement).toBe(70);
  });

  it("returns empty data when no contacts exist", async () => {
    const db = makeMockDb([], 0);

    const result = await aggregateConversationData(db, "creator-1", 30);

    expect(result.topicFrequencies).toEqual({});
    expect(result.topicSentiments).toEqual({});
    expect(result.platformStats).toEqual({});
    expect(result.engagementDropCount).toBe(0);
    expect(result.totalContacts).toBe(0);
    expect(result.totalMessages).toBe(0);
  });

  it("detects engagement drops from scoring history", async () => {
    const contacts = [
      makeContact("telegram", {
        engagementLevel: 30,
        behavioralSignals: { topicFrequency: {} },
        scoringHistory: { engagement: [80, 60, 40] }, // 40 < 80 * 0.7 = 56
      }),
      makeContact("telegram", {
        engagementLevel: 70,
        behavioralSignals: { topicFrequency: {} },
        scoringHistory: { engagement: [70, 72, 75] }, // no drop
      }),
    ];
    const db = makeMockDb(contacts, 50);

    const result = await aggregateConversationData(db, "creator-1", 30);

    expect(result.engagementDropCount).toBe(1);
  });

  it("builds platform top topics sorted by frequency", async () => {
    const contacts = [
      makeContact("instagram", {
        engagementLevel: 50,
        behavioralSignals: {
          topicFrequency: { moda: 10, viajes: 2, fitness: 8 },
          sentimentTrend: 0.5,
        },
      }),
    ];
    const db = makeMockDb(contacts, 20);

    const result = await aggregateConversationData(db, "creator-1", 7);

    const igTopics = result.platformStats["instagram"].topTopics;
    expect(igTopics[0]).toBe("moda");
    expect(igTopics[1]).toBe("fitness");
    expect(igTopics[2]).toBe("viajes");
  });
});

// ============================================================
// getTopicTrends
// ============================================================

describe("getTopicTrends", () => {
  it("returns topics sorted by frequency with avg sentiment", async () => {
    const contacts = [
      {
        profile: {
          behavioralSignals: {
            topicFrequency: { fotos: 10, videos: 3 },
            sentimentTrend: 0.8,
          },
        },
      },
      {
        profile: {
          behavioralSignals: {
            topicFrequency: { fotos: 5, chat: 7 },
            sentimentTrend: 0.4,
          },
        },
      },
    ];
    const db = {
      query: { contacts: { findMany: vi.fn().mockResolvedValue(contacts) } },
    };

    const result = await getTopicTrends(db, "creator-1");

    expect(result[0].topic).toBe("fotos");
    expect(result[0].frequency).toBe(15);
    expect(result[0].avgSentiment).toBe(0.6); // (0.8 + 0.4) / 2
    expect(result[1].topic).toBe("chat");
    expect(result[1].frequency).toBe(7);
    expect(result[2].topic).toBe("videos");
    expect(result).toHaveLength(3);
  });

  it("returns empty array when no contacts have topic data", async () => {
    const contacts = [
      { profile: { behavioralSignals: null } },
      { profile: null },
    ];
    const db = {
      query: { contacts: { findMany: vi.fn().mockResolvedValue(contacts) } },
    };

    const result = await getTopicTrends(db, "creator-1");

    expect(result).toEqual([]);
  });

  it("limits to top 20 topics", async () => {
    const topicFrequency: Record<string, number> = {};
    for (let i = 0; i < 25; i++) {
      topicFrequency[`topic_${i}`] = 25 - i;
    }
    const contacts = [
      { profile: { behavioralSignals: { topicFrequency, sentimentTrend: 0 } } },
    ];
    const db = {
      query: { contacts: { findMany: vi.fn().mockResolvedValue(contacts) } },
    };

    const result = await getTopicTrends(db, "creator-1");

    expect(result).toHaveLength(20);
    expect(result[0].topic).toBe("topic_0");
    expect(result[19].topic).toBe("topic_19");
  });
});

// ============================================================
// analyzeContentGaps
// ============================================================

describe("analyzeContentGaps", () => {
  const baseData: AggregatedData = {
    topicFrequencies: { fotos: 15, videos: 8 },
    topicSentiments: { fotos: [0.6, 0.8], videos: [0.4] },
    platformStats: {
      onlyfans: { contacts: 10, avgEngagement: 72, topTopics: ["fotos", "videos"] },
    },
    engagementDropCount: 3,
    totalContacts: 10,
    totalMessages: 200,
  };

  it("parses valid AI JSON response into ContentGapReport", async () => {
    const aiResponse = makeValidAIResponse();
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify(aiResponse),
      tokensUsed: 500,
    });

    const result = await analyzeContentGaps(aiConfig, baseData);

    expect(result.topRequestedTopics).toHaveLength(1);
    expect(result.topRequestedTopics[0].topic).toBe("fotos");
    expect(result.engagementDropPoints).toHaveLength(1);
    expect(result.contentOpportunities).toHaveLength(1);
    expect(result.contentOpportunities[0].estimatedDemand).toBe("high");
    expect(result.platformBreakdown).toHaveLength(1);
    expect(result.trendingThemes).toEqual(["exclusivo", "detras de camaras"]);
    expect(result.summary).toBe("Los fans piden mas contenido exclusivo.");
    expect(result.tokensUsed).toBe(500);
  });

  it("returns fallback report when AI response is not parseable", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: "Sorry, I cannot generate the analysis right now.",
      tokensUsed: 100,
    });

    const result = await analyzeContentGaps(aiConfig, baseData);

    expect(result.topRequestedTopics).toEqual([]);
    expect(result.engagementDropPoints).toEqual([]);
    expect(result.contentOpportunities).toEqual([]);
    expect(result.platformBreakdown).toEqual([]);
    expect(result.trendingThemes).toEqual([]);
    expect(result.summary).toBe("No se pudo generar el analisis de contenido.");
    expect(result.tokensUsed).toBe(100);
  });

  it("includes language instruction when language is provided", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify(makeValidAIResponse()),
      tokensUsed: 400,
    });

    await analyzeContentGaps(aiConfig, baseData, "en");

    expect(mockGetLang).toHaveBeenCalledWith("en");
    const systemPrompt = mockCallAI.mock.calls[0][1] as string;
    expect(systemPrompt).toContain("Responde en en.");
  });

  it("does not include language instruction when language is not set", async () => {
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify(makeValidAIResponse()),
      tokensUsed: 400,
    });

    await analyzeContentGaps(aiConfig, baseData);

    expect(mockGetLang).not.toHaveBeenCalled();
  });

  it("handles AI response wrapped in markdown code block", async () => {
    const aiResponse = makeValidAIResponse();
    mockCallAI.mockResolvedValueOnce({
      text: "```json\n" + JSON.stringify(aiResponse) + "\n```",
      tokensUsed: 450,
    });

    const result = await analyzeContentGaps(aiConfig, baseData);

    expect(result.topRequestedTopics).toHaveLength(1);
    expect(result.summary).toBe("Los fans piden mas contenido exclusivo.");
  });

  it("clamps avgSentiment to [-1, 1] range", async () => {
    const aiResponse = makeValidAIResponse();
    aiResponse.topRequestedTopics[0].avgSentiment = 5.0;
    mockCallAI.mockResolvedValueOnce({
      text: JSON.stringify(aiResponse),
      tokensUsed: 300,
    });

    const result = await analyzeContentGaps(aiConfig, baseData);

    expect(result.topRequestedTopics[0].avgSentiment).toBe(1);
  });
});
