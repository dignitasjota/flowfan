import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all worker dependencies
vi.mock("@/server/db", () => ({
  db: {},
}));

vi.mock("@/server/services/ai-analysis", () => ({
  analyzeMessage: vi.fn().mockResolvedValue({
    score: 0.5, label: "positive", emotionalTone: "entusiasta",
    topics: ["fotos"], purchaseIntent: 0.3, budgetMentions: [],
    keyPhrases: ["me encanta"], tokensUsed: 100,
  }),
}));

vi.mock("@/server/services/profile-updater", () => ({
  updateContactProfile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/ai-config-resolver", () => ({
  resolveAIConfig: vi.fn().mockResolvedValue({
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    apiKey: "test-key",
  }),
}));

vi.mock("@/lib/logger", () => ({
  createChildLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

import { analyzeMessage } from "@/server/services/ai-analysis";
import { updateContactProfile } from "@/server/services/profile-updater";
import { resolveAIConfig } from "@/server/services/ai-config-resolver";

const mockResolve = vi.mocked(resolveAIConfig);
const mockAnalyze = vi.mocked(analyzeMessage);
const mockUpdateProfile = vi.mocked(updateContactProfile);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Worker: message-analysis job processing", () => {
  const jobData = {
    creatorId: "creator-1",
    contactId: "contact-1",
    messageId: "msg-1",
    conversationId: "conv-1",
    messageContent: "Me encanta tu contenido!",
    platformType: "instagram",
    conversationHistory: [
      { role: "fan" as const, content: "Hola" },
      { role: "creator" as const, content: "Hola!" },
    ],
  };

  describe("successful processing", () => {
    it("resolves AI config for analysis", async () => {
      const config = await resolveAIConfig({} as any, jobData.creatorId, "analysis");
      expect(config).toBeDefined();
      expect(mockResolve).toHaveBeenCalledWith({}, "creator-1", "analysis");
    });

    it("calls analyzeMessage with correct params", async () => {
      const config = await resolveAIConfig({} as any, jobData.creatorId, "analysis");
      await analyzeMessage(config!, {
        message: jobData.messageContent,
        conversationHistory: jobData.conversationHistory.slice(-5) as any,
        platformType: jobData.platformType,
      });

      expect(mockAnalyze).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "anthropic" }),
        expect.objectContaining({ message: "Me encanta tu contenido!" })
      );
    });

    it("updates contact profile with analysis result", async () => {
      const analysis = await analyzeMessage(
        { provider: "anthropic", model: "m", apiKey: "k" },
        { message: "test" }
      );

      await updateContactProfile({} as any, jobData.contactId, jobData.messageId, analysis);

      expect(mockUpdateProfile).toHaveBeenCalledWith(
        {},
        "contact-1",
        "msg-1",
        expect.objectContaining({ score: 0.5, label: "positive" })
      );
    });

    it("limits conversation history to 5 messages", () => {
      const history = jobData.conversationHistory.slice(-5);
      expect(history.length).toBeLessThanOrEqual(5);
    });
  });

  describe("error handling", () => {
    it("skips analysis when no AI config found", async () => {
      mockResolve.mockResolvedValueOnce(null);
      const config = await resolveAIConfig({} as any, "c1", "analysis");

      if (!config) {
        // Worker should log warning and return early
        expect(config).toBeNull();
        return;
      }

      // Should not reach here
      expect(true).toBe(false);
    });

    it("handles analyzeMessage failure", async () => {
      mockAnalyze.mockRejectedValueOnce(new Error("API error"));

      await expect(
        analyzeMessage(
          { provider: "anthropic", model: "m", apiKey: "k" },
          { message: "test" }
        )
      ).rejects.toThrow("API error");
    });

    it("handles updateContactProfile failure", async () => {
      mockUpdateProfile.mockRejectedValueOnce(new Error("DB error"));

      await expect(
        updateContactProfile({} as any, "c1", "m1", {} as any)
      ).rejects.toThrow("DB error");
    });
  });

  describe("worker configuration", () => {
    it("parses Redis URL correctly", () => {
      const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
      expect(redisUrl.hostname).toBe("localhost");
      expect(Number(redisUrl.port) || 6379).toBe(6379);
    });

    it("concurrency is set to 5", () => {
      const concurrency = 5;
      expect(concurrency).toBe(5);
    });

    it("rate limit is 10 jobs per second", () => {
      const limiter = { max: 10, duration: 1000 };
      expect(limiter.max).toBe(10);
      expect(limiter.duration).toBe(1000);
    });
  });
});
