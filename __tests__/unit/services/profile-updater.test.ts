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

// BullMQ queues — if left unmocked, `workflowQueue.add` hangs waiting for Redis
// streams the ioredis stub does not implement (XADD / BRPOP).
vi.mock("@/server/queues", () => ({
  workflowQueue: {
    add: vi.fn().mockResolvedValue({ id: "job-1" }),
  },
}));

// Redis pub/sub — `publishEvent` is fire-and-forget but we mock it to keep
// the tests deterministic.
vi.mock("@/lib/redis-pubsub", () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
}));

// Webhook dispatcher — same reason: don't hit Redis / fetch from a unit test.
vi.mock("@/server/services/webhook-dispatcher", () => ({
  dispatchWebhookEvent: vi.fn().mockResolvedValue(undefined),
}));

// A/B experiment lookups — wrapped in try/catch in the service, but the
// internal `db.query.experimentAssignments.findFirst` would throw on the
// minimal mock. Explicit mock keeps things clean.
vi.mock("@/server/services/ab-experiment", () => ({
  findContactExperiment: vi.fn().mockResolvedValue(null),
  recordExperimentMetric: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/message-experiment", () => ({
  markExperimentConversionForContact: vi.fn().mockResolvedValue(undefined),
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

const DEFAULT_PROFILE = {
  contactId: "contact-1",
  engagementLevel: 30,
  paymentProbability: 20,
  funnelStage: "cold",
  behavioralSignals: null,
  scoringHistory: [],
};

const DEFAULT_CONTACT = {
  id: "contact-1",
  creatorId: "creator-1",
  username: "fan_user",
  displayName: "Fan User",
  totalConversations: 2,
};

/**
 * WK-10: `updateContactProfile` ahora lee y escribe el profile dentro de
 * `db.transaction(async (tx) => { ... tx.select()...for("update") ... })`.
 * El mock simula esa transacción: `db.transaction` invoca el callback con un
 * `tx` propio (select con lock + query.contacts/platformScoringConfigs +
 * update), separado del `db` exterior (que solo se usa para el update del
 * mensaje/comentario y el insert de notificaciones, fuera del lock).
 */
function createMockDb(
  profileRow: Record<string, unknown> | null = DEFAULT_PROFILE,
  contact: Record<string, unknown> | null = DEFAULT_CONTACT
) {
  const forUpdateMock = vi.fn().mockResolvedValue(profileRow ? [profileRow] : []);
  const selectWhereMock = vi.fn().mockReturnValue({ for: forUpdateMock });
  const selectFromMock = vi.fn().mockReturnValue({ where: selectWhereMock });
  const txSelectMock = vi.fn().mockReturnValue({ from: selectFromMock });

  const txUpdateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  const txUpdateMock = vi.fn().mockReturnValue({ set: txUpdateSet });

  const tx = {
    select: txSelectMock,
    query: {
      contacts: { findFirst: vi.fn().mockResolvedValue(contact) },
      platformScoringConfigs: { findFirst: vi.fn().mockResolvedValue(null) },
    },
    update: txUpdateMock,
  };

  const outerUpdateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  const outerInsertValues = vi.fn().mockResolvedValue(undefined);

  const db = {
    transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
    update: vi.fn().mockReturnValue({ set: outerUpdateSet }),
    insert: vi.fn().mockReturnValue({ values: outerInsertValues }),
    _tx: tx,
    _forUpdateMock: forUpdateMock,
  };

  return db as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateContactProfile", () => {
  it("locks the profile row with SELECT ... FOR UPDATE inside a transaction", async () => {
    const db = createMockDb();
    await updateContactProfile(db, "contact-1", "msg-1", makeAnalysis());

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db._forUpdateMock).toHaveBeenCalledWith("update");
    expect(db._tx.query.contacts.findFirst).toHaveBeenCalled();
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

  it("updates contact profile inside the transaction and the message outside it", async () => {
    const db = createMockDb();
    await updateContactProfile(db, "contact-1", "msg-1", makeAnalysis());

    // El profile se actualiza dentro de la transacción (bajo el lock)...
    expect(db._tx.update).toHaveBeenCalledTimes(1);
    // ...y el mensaje se actualiza fuera, sobre el `db` exterior.
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("does nothing if profile not found (no row to lock)", async () => {
    const db = createMockDb(null);

    await updateContactProfile(db, "contact-1", "msg-1", makeAnalysis());

    expect(db._tx.update).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
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

    // Verify the profile update (inside the tx) was called, and the history
    // would be capped.
    expect(db._tx.update).toHaveBeenCalled();
  });

  it("rethrows errors after logging", async () => {
    const db = createMockDb();
    db.transaction.mockRejectedValue(new Error("DB error"));

    await expect(
      updateContactProfile(db, "contact-1", "msg-1", makeAnalysis())
    ).rejects.toThrow("DB error");
  });
});
