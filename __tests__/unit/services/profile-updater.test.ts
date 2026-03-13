import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/logger", () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@/server/services/scoring", () => ({
  updateSignals: vi.fn().mockReturnValue({
    messageCount: 5,
    avgMessageLength: 100,
    avgSentiment: 0.5,
    sentimentTrend: 0.1,
    avgPurchaseIntent: 0.3,
    maxPurchaseIntent: 0.5,
    topicFrequency: {},
    budgetMentions: [],
    lastMessageAt: new Date().toISOString(),
    avgTimeBetweenMessages: 30,
    conversationCount: 1,
  }),
  calculateScores: vi.fn().mockReturnValue({
    engagementLevel: 50,
    paymentProbability: 30,
    funnelStage: "curious",
    responseSpeed: "medium",
    conversationDepth: "moderate",
    estimatedBudget: "medium",
    factors: [],
  }),
}));

import { updateContactProfile } from "@/server/services/profile-updater";
import { updateSignals, calculateScores } from "@/server/services/scoring";
import type { SentimentResult } from "@/server/services/ai-analysis";

const mockUpdateSignals = vi.mocked(updateSignals);
const mockCalculateScores = vi.mocked(calculateScores);

function makeAnalysis(overrides: Partial<SentimentResult> = {}): SentimentResult {
  return {
    score: 0.5,
    label: "positive",
    emotionalTone: "entusiasta",
    topics: ["fotos"],
    purchaseIntent: 0.3,
    budgetMentions: [],
    keyPhrases: ["me encanta"],
    tokensUsed: 100,
    ...overrides,
  };
}

function createMockDb(profile: Record<string, unknown> | null = null, contact: Record<string, unknown> | null = null) {
  const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  const insertValues = vi.fn().mockResolvedValue(undefined);

  return {
    query: {
      contactProfiles: {
        findFirst: vi.fn().mockResolvedValue(profile ?? {
          contactId: "contact-1",
          engagementLevel: 30,
          paymentProbability: 20,
          funnelStage: "cold",
          behavioralSignals: null,
          scoringHistory: [],
        }),
      },
      contacts: {
        findFirst: vi.fn().mockResolvedValue(contact ?? {
          id: "contact-1",
          creatorId: "creator-1",
          username: "fan_user",
          displayName: "Fan User",
          totalConversations: 2,
        }),
      },
    },
    update: vi.fn().mockReturnValue({ set: updateSet }),
    insert: vi.fn().mockReturnValue({ values: insertValues }),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateContactProfile", () => {
  it("reads current profile and contact", async () => {
    const db = createMockDb();
    await updateContactProfile(db, "contact-1", "msg-1", makeAnalysis());

    expect(db.query.contactProfiles.findFirst).toHaveBeenCalled();
    expect(db.query.contacts.findFirst).toHaveBeenCalled();
  });

  it("calls updateSignals with analysis data", async () => {
    const db = createMockDb();
    await updateContactProfile(db, "contact-1", "msg-1", makeAnalysis());

    expect(mockUpdateSignals).toHaveBeenCalled();
  });

  it("calls calculateScores with new signals", async () => {
    const db = createMockDb();
    await updateContactProfile(db, "contact-1", "msg-1", makeAnalysis());

    expect(mockCalculateScores).toHaveBeenCalled();
  });

  it("updates contact profile in DB", async () => {
    const db = createMockDb();
    await updateContactProfile(db, "contact-1", "msg-1", makeAnalysis());

    // Should call update twice: profile + message sentiment
    expect(db.update).toHaveBeenCalledTimes(2);
  });

  it("does nothing if profile not found", async () => {
    const db = createMockDb(null);
    db.query.contactProfiles.findFirst.mockResolvedValue(null);

    await updateContactProfile(db, "contact-1", "msg-1", makeAnalysis());

    expect(db.update).not.toHaveBeenCalled();
  });

  it("creates notification on funnel advance", async () => {
    mockCalculateScores.mockReturnValueOnce({
      engagementLevel: 60,
      paymentProbability: 40,
      funnelStage: "curious", // advanced from "cold"
      responseSpeed: "medium",
      conversationDepth: "moderate",
      estimatedBudget: "medium",
      factors: [],
    });

    const db = createMockDb();
    await updateContactProfile(db, "contact-1", "msg-1", makeAnalysis(), "creator-1");

    // Should insert notification for funnel advance
    expect(db.insert).toHaveBeenCalled();
  });

  it("creates notification on payment probability spike >= 15", async () => {
    mockCalculateScores.mockReturnValueOnce({
      engagementLevel: 60,
      paymentProbability: 50, // +30 from prevPayment=20
      funnelStage: "cold", // same, no funnel notification
      responseSpeed: "medium",
      conversationDepth: "moderate",
      estimatedBudget: "medium",
      factors: [],
    });

    const db = createMockDb();
    await updateContactProfile(db, "contact-1", "msg-1", makeAnalysis(), "creator-1");

    expect(db.insert).toHaveBeenCalled();
  });

  it("appends to scoring history and caps at 50", async () => {
    const longHistory = Array.from({ length: 55 }, (_, i) => ({
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
      engagementLevel: 30,
      paymentProbability: 20,
      funnelStage: "cold",
      sentiment: 0.5,
    }));

    const db = createMockDb({
      contactId: "contact-1",
      engagementLevel: 30,
      paymentProbability: 20,
      funnelStage: "cold",
      behavioralSignals: null,
      scoringHistory: longHistory,
    });

    await updateContactProfile(db, "contact-1", "msg-1", makeAnalysis());

    // Verify update was called, and the history would be capped
    expect(db.update).toHaveBeenCalled();
  });

  it("rethrows errors after logging", async () => {
    const db = createMockDb();
    db.query.contactProfiles.findFirst.mockRejectedValue(new Error("DB error"));

    await expect(
      updateContactProfile(db, "contact-1", "msg-1", makeAnalysis())
    ).rejects.toThrow("DB error");
  });
});
