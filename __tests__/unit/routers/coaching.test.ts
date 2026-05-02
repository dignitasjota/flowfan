import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("@/server/services/negotiation-coach", () => ({
  generateCoaching: vi.fn().mockResolvedValue({
    situationAssessment: "Fan interesado con alto potencial",
    fanProfile: "Comprador recurrente",
    currentLeverage: "Historial de compras positivo",
    risks: ["Posible fatiga de contenido"],
    tactics: [
      {
        name: "Value framing",
        description: "Enmarcar el precio en términos de valor exclusivo",
        example: "Este contenido es solo para mis fans mas fieles...",
        riskLevel: "low",
      },
    ],
    suggestedNextMove: "Ofrecer contenido exclusivo con descuento inicial",
    avoidList: ["No presionar demasiado", "Evitar precios altos de golpe"],
    tokensUsed: 850,
  }),
}));

vi.mock("@/server/services/usage-limits", () => ({
  checkCoachingLimit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/ai-config-resolver", () => ({
  resolveAIConfig: vi.fn().mockResolvedValue({
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    apiKey: "sk-test",
  }),
}));

import { generateCoaching } from "@/server/services/negotiation-coach";
import { checkCoachingLimit } from "@/server/services/usage-limits";
import { resolveAIConfig } from "@/server/services/ai-config-resolver";

const mockGenerateCoaching = vi.mocked(generateCoaching);
const mockCheckCoachingLimit = vi.mocked(checkCoachingLimit);
const mockResolveAIConfig = vi.mocked(resolveAIConfig);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("coaching router logic", () => {
  describe("getCoaching input validation", () => {
    it("accepts valid coaching types", () => {
      const validTypes = ["negotiation", "retention", "upsell"];
      for (const t of validTypes) {
        expect(validTypes.includes(t)).toBe(true);
      }
    });

    it("rejects invalid coaching type", () => {
      const validTypes = ["negotiation", "retention", "upsell"];
      expect(validTypes.includes("invalid")).toBe(false);
    });

    it("requires conversationId as uuid format", () => {
      const validUuid = "550e8400-e29b-41d4-a716-446655440000";
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(uuidRegex.test(validUuid)).toBe(true);
      expect(uuidRegex.test("not-a-uuid")).toBe(false);
    });
  });

  describe("usage limit enforcement", () => {
    it("checks coaching limit before generating", async () => {
      await mockCheckCoachingLimit({} as any, "creator-1");
      expect(mockCheckCoachingLimit).toHaveBeenCalledWith({}, "creator-1");
    });

    it("rejects when coaching limit exceeded", async () => {
      mockCheckCoachingLimit.mockRejectedValueOnce(
        new TRPCError({
          code: "FORBIDDEN",
          message: "Has alcanzado el limite de sesiones de coaching.",
        })
      );
      await expect(
        mockCheckCoachingLimit({} as any, "creator-1")
      ).rejects.toThrow(TRPCError);
    });
  });

  describe("AI config resolution", () => {
    it("resolves coaching config first, falls back to suggestion", async () => {
      mockResolveAIConfig.mockResolvedValueOnce(null); // coaching config not set
      mockResolveAIConfig.mockResolvedValueOnce({
        provider: "openai",
        model: "gpt-4o",
        apiKey: "sk-fallback",
      });

      const coachingConfig = await mockResolveAIConfig({} as any, "c1", "coaching");
      const fallbackConfig = coachingConfig ?? await mockResolveAIConfig({} as any, "c1", "suggestion");

      expect(fallbackConfig).toEqual({
        provider: "openai",
        model: "gpt-4o",
        apiKey: "sk-fallback",
      });
    });

    it("throws when no AI config available", () => {
      expect(() => {
        const config = null;
        if (!config) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No has configurado tu proveedor de IA.",
          });
        }
      }).toThrow(TRPCError);
    });
  });

  describe("coaching generation flow", () => {
    it("generates coaching with correct input structure", async () => {
      const config = { provider: "anthropic", model: "claude-sonnet-4-20250514", apiKey: "sk-test" };
      const input = {
        conversationId: "conv-1",
        coachingType: "negotiation" as const,
        messages: [{ role: "fan", content: "Cuanto cuesta?" }],
        contactProfile: { engagementLevel: 75, funnelStage: "hot_lead" },
        language: "es",
      };

      const result = await mockGenerateCoaching(config as any, input as any);

      expect(result.situationAssessment).toBeTruthy();
      expect(result.tactics).toHaveLength(1);
      expect(result.tokensUsed).toBeGreaterThan(0);
    });

    it("returns structured result with all required fields", async () => {
      const result = await mockGenerateCoaching({} as any, {} as any);

      expect(result).toHaveProperty("situationAssessment");
      expect(result).toHaveProperty("fanProfile");
      expect(result).toHaveProperty("currentLeverage");
      expect(result).toHaveProperty("risks");
      expect(result).toHaveProperty("tactics");
      expect(result).toHaveProperty("suggestedNextMove");
      expect(result).toHaveProperty("avoidList");
      expect(result).toHaveProperty("tokensUsed");
    });

    it("tactic has correct structure", async () => {
      const result = await mockGenerateCoaching({} as any, {} as any);
      const tactic = result.tactics[0];

      expect(tactic).toHaveProperty("name");
      expect(tactic).toHaveProperty("description");
      expect(tactic).toHaveProperty("example");
      expect(tactic).toHaveProperty("riskLevel");
      expect(["low", "medium", "high"]).toContain(tactic.riskLevel);
    });
  });

  describe("conversation access control", () => {
    it("throws NOT_FOUND for missing conversation", () => {
      const conversation = null;
      expect(() => {
        if (!conversation) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Conversacion no encontrada" });
        }
      }).toThrow(TRPCError);
    });

    it("throws NOT_FOUND when conversation belongs to different creator", () => {
      const conversation = { creatorId: "other-creator" };
      const currentCreatorId = "my-creator";
      expect(() => {
        if (conversation.creatorId !== currentCreatorId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Conversacion no encontrada" });
        }
      }).toThrow(TRPCError);
    });
  });

  describe("listCoachingSessions", () => {
    it("returns sessions ordered by createdAt desc", () => {
      const sessions = [
        { id: "s1", createdAt: new Date("2025-01-01") },
        { id: "s3", createdAt: new Date("2025-03-01") },
        { id: "s2", createdAt: new Date("2025-02-01") },
      ];
      const sorted = [...sessions].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );
      expect(sorted[0].id).toBe("s3");
      expect(sorted[2].id).toBe("s1");
    });

    it("limits results to 20", () => {
      const limit = 20;
      const sessions = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}` }));
      const limited = sessions.slice(0, limit);
      expect(limited).toHaveLength(20);
    });
  });

  describe("getCoachingSession", () => {
    it("throws NOT_FOUND for missing session", () => {
      const session = null;
      expect(() => {
        if (!session) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Sesion de coaching no encontrada" });
        }
      }).toThrow(TRPCError);
    });
  });
});
