import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/schema", () => ({
  conversationModeExperiments: {
    id: "id",
    creatorId: "creator_id",
    modeType: "mode_type",
    status: "status",
    trafficSplit: "traffic_split",
    variantAConfig: "variant_a_config",
    variantBConfig: "variant_b_config",
  },
  experimentAssignments: {
    id: "id",
    experimentId: "experiment_id",
    contactId: "contact_id",
    variant: "variant",
  },
  experimentMetrics: {
    id: "id",
    experimentId: "experiment_id",
    contactId: "contact_id",
    variant: "variant",
    metricType: "metric_type",
    value: "value",
  },
}));

import {
  assignContactToVariant,
  getExperimentModeConfig,
  recordExperimentMetric,
  findContactExperiment,
  calculateExperimentResults,
} from "@/server/services/ab-experiment";

function createMockDb(overrides: Record<string, any> = {}) {
  const valuesFn = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) });
  const insertFn = vi.fn().mockReturnValue({ values: valuesFn });

  return {
    insert: insertFn,
    query: {
      experimentAssignments: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      conversationModeExperiments: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      experimentMetrics: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
    _insertFn: insertFn,
    _valuesFn: valuesFn,
    ...overrides,
  } as any;
}

describe("ab-experiment", () => {
  // ============================================================
  // assignContactToVariant
  // ============================================================
  describe("assignContactToVariant", () => {
    it("returns existing assignment without inserting", async () => {
      const db = createMockDb();
      db.query.experimentAssignments.findFirst.mockResolvedValue({
        variant: "B",
      });

      const result = await assignContactToVariant(db, "exp-1", "contact-1", 50);

      expect(result).toBe("B");
      expect(db._insertFn).not.toHaveBeenCalled();
    });

    it("inserts and returns variant when no existing assignment", async () => {
      const db = createMockDb();

      const result = await assignContactToVariant(db, "exp-1", "contact-1", 50);

      expect(result).toMatch(/^[AB]$/);
      expect(db._insertFn).toHaveBeenCalledOnce();
    });

    it("is deterministic - same inputs always produce same output", async () => {
      const results: string[] = [];

      for (let i = 0; i < 5; i++) {
        const db = createMockDb();
        const result = await assignContactToVariant(db, "exp-100", "contact-42", 50);
        results.push(result);
      }

      expect(new Set(results).size).toBe(1);
    });

    it("different contactIds can produce different variants", async () => {
      const variants = new Set<string>();

      // Try many contacts to ensure both variants appear with 50/50 split
      for (let i = 0; i < 50; i++) {
        const db = createMockDb();
        const result = await assignContactToVariant(db, "exp-1", `contact-${i}`, 50);
        variants.add(result);
      }

      expect(variants.size).toBe(2);
      expect(variants.has("A")).toBe(true);
      expect(variants.has("B")).toBe(true);
    });

    it("trafficSplit=0 assigns all to A", async () => {
      const results: string[] = [];

      for (let i = 0; i < 20; i++) {
        const db = createMockDb();
        const result = await assignContactToVariant(db, "exp-1", `c-${i}`, 0);
        results.push(result);
      }

      expect(results.every((r) => r === "A")).toBe(true);
    });

    it("trafficSplit=100 assigns all to B", async () => {
      const results: string[] = [];

      for (let i = 0; i < 20; i++) {
        const db = createMockDb();
        const result = await assignContactToVariant(db, "exp-1", `c-${i}`, 100);
        results.push(result);
      }

      expect(results.every((r) => r === "B")).toBe(true);
    });
  });

  // ============================================================
  // getExperimentModeConfig
  // ============================================================
  describe("getExperimentModeConfig", () => {
    it("returns null when no running experiment exists", async () => {
      const db = createMockDb();

      const result = await getExperimentModeConfig(db, "creator-1", "VIP", "contact-1");

      expect(result).toBeNull();
    });

    it("returns variant config and experiment info when experiment is running", async () => {
      const db = createMockDb();
      db.query.conversationModeExperiments.findFirst.mockResolvedValue({
        id: "exp-1",
        creatorId: "creator-1",
        modeType: "VIP",
        status: "running",
        trafficSplit: 50,
        variantAConfig: { tone: "friendly" },
        variantBConfig: { tone: "seductive" },
      });

      const result = await getExperimentModeConfig(db, "creator-1", "VIP", "contact-1");

      expect(result).not.toBeNull();
      expect(result!.experimentId).toBe("exp-1");
      expect(result!.variant).toMatch(/^[AB]$/);
      if (result!.variant === "A") {
        expect(result!.config).toEqual({ tone: "friendly" });
      } else {
        expect(result!.config).toEqual({ tone: "seductive" });
      }
    });
  });

  // ============================================================
  // recordExperimentMetric
  // ============================================================
  describe("recordExperimentMetric", () => {
    it("inserts metric with provided value", async () => {
      const valuesFn = vi.fn().mockResolvedValue(undefined);
      const db = createMockDb();
      db.insert.mockReturnValue({ values: valuesFn });

      await recordExperimentMetric(db, "exp-1", "contact-1", "A", "conversion", 1);

      expect(db.insert).toHaveBeenCalledOnce();
      expect(valuesFn).toHaveBeenCalledWith({
        experimentId: "exp-1",
        contactId: "contact-1",
        variant: "A",
        metricType: "conversion",
        value: 1,
      });
    });

    it("defaults value to 1 when not provided", async () => {
      const valuesFn = vi.fn().mockResolvedValue(undefined);
      const db = createMockDb();
      db.insert.mockReturnValue({ values: valuesFn });

      await recordExperimentMetric(db, "exp-1", "contact-1", "B", "fan_replied");

      expect(valuesFn).toHaveBeenCalledWith(
        expect.objectContaining({ value: 1 })
      );
    });
  });

  // ============================================================
  // findContactExperiment
  // ============================================================
  describe("findContactExperiment", () => {
    it("returns null when no assignment exists", async () => {
      const db = createMockDb();

      const result = await findContactExperiment(db, "contact-1");

      expect(result).toBeNull();
    });

    it("returns null when experiment is not running", async () => {
      const db = createMockDb();
      db.query.experimentAssignments.findFirst.mockResolvedValue({
        experimentId: "exp-1",
        variant: "A",
        experiment: { status: "completed" },
      });

      const result = await findContactExperiment(db, "contact-1");

      expect(result).toBeNull();
    });

    it("returns experiment info when assignment exists and experiment is running", async () => {
      const db = createMockDb();
      db.query.experimentAssignments.findFirst.mockResolvedValue({
        experimentId: "exp-1",
        variant: "B",
        experiment: { status: "running" },
      });

      const result = await findContactExperiment(db, "contact-1");

      expect(result).toEqual({ experimentId: "exp-1", variant: "B" });
    });
  });

  // ============================================================
  // calculateExperimentResults
  // ============================================================
  describe("calculateExperimentResults", () => {
    it("returns zero metrics when no assignments or metrics exist", async () => {
      const db = createMockDb();

      const result = await calculateExperimentResults(db, "exp-1");

      expect(result.variantA.totalContacts).toBe(0);
      expect(result.variantB.totalContacts).toBe(0);
      expect(result.confidence).toBe(0);
      expect(result.suggestedWinner).toBeNull();
    });

    it("aggregates metrics correctly per variant", async () => {
      const db = createMockDb();
      db.query.experimentAssignments.findMany.mockResolvedValue([
        { variant: "A" },
        { variant: "A" },
        { variant: "B" },
      ]);
      db.query.experimentMetrics.findMany.mockResolvedValue([
        { variant: "A", metricType: "response_sent", value: 1 },
        { variant: "A", metricType: "fan_replied", value: 1 },
        { variant: "A", metricType: "conversion", value: 1 },
        { variant: "B", metricType: "response_sent", value: 1 },
        { variant: "B", metricType: "tip_received", value: 5 },
      ]);

      const result = await calculateExperimentResults(db, "exp-1");

      expect(result.variantA.totalContacts).toBe(2);
      expect(result.variantA.responseSent).toBe(1);
      expect(result.variantA.fanReplied).toBe(1);
      expect(result.variantA.conversions).toBe(1);
      expect(result.variantA.conversionRate).toBe(0.5);

      expect(result.variantB.totalContacts).toBe(1);
      expect(result.variantB.tipsReceived).toBe(5);
      expect(result.variantB.conversions).toBe(0);
    });

    it("returns confidence=0 when sample sizes are below 10", async () => {
      const db = createMockDb();
      db.query.experimentAssignments.findMany.mockResolvedValue([
        ...Array(5).fill({ variant: "A" }),
        ...Array(5).fill({ variant: "B" }),
      ]);
      db.query.experimentMetrics.findMany.mockResolvedValue([
        { variant: "A", metricType: "conversion", value: 1 },
      ]);

      const result = await calculateExperimentResults(db, "exp-1");

      expect(result.confidence).toBe(0);
      expect(result.suggestedWinner).toBeNull();
    });

    it("returns confidence=0 when conversion rates are equal", async () => {
      const db = createMockDb();
      const aAssignments = Array(20).fill({ variant: "A" });
      const bAssignments = Array(20).fill({ variant: "B" });
      db.query.experimentAssignments.findMany.mockResolvedValue([
        ...aAssignments,
        ...bAssignments,
      ]);
      // Same number of conversions for both
      db.query.experimentMetrics.findMany.mockResolvedValue([
        ...Array(5).fill({ variant: "A", metricType: "conversion", value: 1 }),
        ...Array(5).fill({ variant: "B", metricType: "conversion", value: 1 }),
      ]);

      const result = await calculateExperimentResults(db, "exp-1");

      // Equal rates => z=0 => confidence ~= 0
      expect(result.confidence).toBeLessThan(0.5);
      expect(result.suggestedWinner).toBeNull();
    });

    it("suggests a winner when confidence >= 0.95", async () => {
      const db = createMockDb();
      const aAssignments = Array(100).fill({ variant: "A" });
      const bAssignments = Array(100).fill({ variant: "B" });
      db.query.experimentAssignments.findMany.mockResolvedValue([
        ...aAssignments,
        ...bAssignments,
      ]);
      // A has 50% conversion, B has 5% -- large difference with n=100
      db.query.experimentMetrics.findMany.mockResolvedValue([
        ...Array(50).fill({ variant: "A", metricType: "conversion", value: 1 }),
        ...Array(5).fill({ variant: "B", metricType: "conversion", value: 1 }),
      ]);

      const result = await calculateExperimentResults(db, "exp-1");

      expect(result.confidence).toBeGreaterThanOrEqual(0.95);
      expect(result.suggestedWinner).toBe("A");
    });

    it("returns confidence=0 when all conversions are zero (pooled=0)", async () => {
      const db = createMockDb();
      db.query.experimentAssignments.findMany.mockResolvedValue([
        ...Array(20).fill({ variant: "A" }),
        ...Array(20).fill({ variant: "B" }),
      ]);
      db.query.experimentMetrics.findMany.mockResolvedValue([]);

      const result = await calculateExperimentResults(db, "exp-1");

      expect(result.confidence).toBe(0);
      expect(result.variantA.conversionRate).toBe(0);
      expect(result.variantB.conversionRate).toBe(0);
    });
  });
});
