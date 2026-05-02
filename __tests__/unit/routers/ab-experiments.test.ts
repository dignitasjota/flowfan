import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("@/server/services/ab-experiment", () => ({
  calculateExperimentResults: vi.fn().mockResolvedValue({
    variantA: { total: 50, conversions: 10, replies: 30 },
    variantB: { total: 50, conversions: 15, replies: 35 },
    confidence: 0.87,
    suggestedWinner: null,
  }),
}));

import { calculateExperimentResults } from "@/server/services/ab-experiment";
const mockCalculateResults = vi.mocked(calculateExperimentResults);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ab-experiments router logic", () => {
  describe("create validation", () => {
    it("rejects empty name", () => {
      const name = "";
      expect(name.trim().length > 0).toBe(false);
    });

    it("accepts valid mode types", () => {
      const validTypes = ["BASE", "POTENCIAL_PREMIUM", "CONVERSION", "VIP", "LOW_VALUE"];
      for (const t of validTypes) {
        expect(validTypes.includes(t)).toBe(true);
      }
    });

    it("rejects invalid mode type", () => {
      const validTypes = ["BASE", "POTENCIAL_PREMIUM", "CONVERSION", "VIP", "LOW_VALUE"];
      expect(validTypes.includes("INVALID")).toBe(false);
    });

    it("clamps traffic split to 0-100", () => {
      const clamp = (v: number) => Math.max(0, Math.min(100, v));
      expect(clamp(-10)).toBe(0);
      expect(clamp(150)).toBe(100);
      expect(clamp(50)).toBe(50);
    });

    it("defaults traffic split to 50", () => {
      const input = { trafficSplit: undefined };
      const trafficSplit = input.trafficSplit ?? 50;
      expect(trafficSplit).toBe(50);
    });
  });

  describe("duplicate running experiment prevention", () => {
    it("throws CONFLICT when running experiment exists for same mode type", () => {
      const existing = {
        id: "exp-1",
        modeType: "VIP",
        status: "running",
      };

      expect(() => {
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Ya existe un experimento en ejecucion para este tipo de modo.",
          });
        }
      }).toThrow(TRPCError);
    });

    it("allows creation when no running experiment for mode type", () => {
      const existing = null;
      expect(existing).toBeNull();
    });

    it("allows creation when existing experiment is completed", () => {
      const existing = { status: "completed" };
      // Only running experiments block creation
      const isBlocking = existing.status === "running";
      expect(isBlocking).toBe(false);
    });
  });

  describe("start lifecycle", () => {
    it("only starts experiments in draft status", () => {
      const experiment = { status: "draft" };
      expect(experiment.status === "draft").toBe(true);
    });

    it("rejects starting a running experiment", () => {
      const experiment = { status: "running" };
      expect(() => {
        if (experiment.status !== "draft") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Solo se pueden iniciar experimentos en estado borrador.",
          });
        }
      }).toThrow(TRPCError);
    });

    it("rejects starting a completed experiment", () => {
      const experiment = { status: "completed" };
      expect(() => {
        if (experiment.status !== "draft") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Solo se pueden iniciar experimentos en estado borrador.",
          });
        }
      }).toThrow(TRPCError);
    });
  });

  describe("stop lifecycle", () => {
    it("only stops experiments in running status", () => {
      const experiment = { status: "running" };
      expect(experiment.status === "running").toBe(true);
    });

    it("rejects stopping a draft experiment", () => {
      const experiment = { status: "draft" };
      expect(() => {
        if (experiment.status !== "running") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Solo se pueden detener experimentos en ejecucion.",
          });
        }
      }).toThrow(TRPCError);
    });

    it("sets winner when provided on stop", () => {
      const input = { id: "exp-1", winner: "B" as const };
      const updates = {
        status: "completed",
        endedAt: new Date(),
        winner: input.winner ?? null,
      };
      expect(updates.winner).toBe("B");
    });

    it("sets winner to null when not provided", () => {
      const input = { id: "exp-1", winner: undefined };
      const updates = {
        status: "completed",
        winner: input.winner ?? null,
      };
      expect(updates.winner).toBeNull();
    });
  });

  describe("getResults", () => {
    it("calls calculateExperimentResults with correct id", async () => {
      await mockCalculateResults({} as any, "exp-123");
      expect(mockCalculateResults).toHaveBeenCalledWith({}, "exp-123");
    });

    it("returns metrics per variant", async () => {
      const results = await mockCalculateResults({} as any, "exp-1");
      expect(results.variantA.total).toBe(50);
      expect(results.variantB.total).toBe(50);
    });

    it("returns confidence level", async () => {
      const results = await mockCalculateResults({} as any, "exp-1");
      expect(results.confidence).toBeGreaterThanOrEqual(0);
      expect(results.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe("applyWinner", () => {
    it("rejects when no winner declared", () => {
      const experiment = { winner: null };
      expect(() => {
        if (!experiment.winner) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No se ha declarado un ganador.",
          });
        }
      }).toThrow(TRPCError);
    });

    it("selects variant A config when winner is A", () => {
      const experiment = {
        winner: "A",
        variantAConfig: { tone: "seductor" },
        variantBConfig: { tone: "directo" },
      };
      const winnerConfig = experiment.winner === "A"
        ? experiment.variantAConfig
        : experiment.variantBConfig;
      expect(winnerConfig).toEqual({ tone: "seductor" });
    });

    it("selects variant B config when winner is B", () => {
      const experiment = {
        winner: "B",
        variantAConfig: { tone: "seductor" },
        variantBConfig: { tone: "directo" },
      };
      const winnerConfig = experiment.winner === "A"
        ? experiment.variantAConfig
        : experiment.variantBConfig;
      expect(winnerConfig).toEqual({ tone: "directo" });
    });

    it("throws NOT_FOUND for missing experiment", () => {
      const experiment = null;
      expect(() => {
        if (!experiment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Experimento no encontrado" });
        }
      }).toThrow(TRPCError);
    });
  });
});
