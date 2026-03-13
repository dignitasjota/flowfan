import { describe, it, expect } from "vitest";
import {
  PLATFORM_TYPES,
  PLATFORM_LABELS,
  PLATFORM_OPTIONS,
  platformTypeSchema,
  FUNNEL_STAGES,
  funnelStageSchema,
  type PlatformType,
  type FunnelStage,
} from "@/lib/constants";

describe("constants", () => {
  describe("PLATFORM_TYPES", () => {
    it("contains all expected platforms", () => {
      expect(PLATFORM_TYPES).toContain("instagram");
      expect(PLATFORM_TYPES).toContain("tinder");
      expect(PLATFORM_TYPES).toContain("reddit");
      expect(PLATFORM_TYPES).toContain("onlyfans");
      expect(PLATFORM_TYPES).toContain("twitter");
      expect(PLATFORM_TYPES).toContain("telegram");
      expect(PLATFORM_TYPES).toContain("snapchat");
      expect(PLATFORM_TYPES).toContain("other");
    });

    it("has 8 platforms", () => {
      expect(PLATFORM_TYPES).toHaveLength(8);
    });
  });

  describe("PLATFORM_LABELS", () => {
    it("has labels for every platform", () => {
      for (const platform of PLATFORM_TYPES) {
        expect(PLATFORM_LABELS[platform]).toBeDefined();
        expect(typeof PLATFORM_LABELS[platform]).toBe("string");
      }
    });
  });

  describe("PLATFORM_OPTIONS", () => {
    it("maps each platform to value/label pair", () => {
      expect(PLATFORM_OPTIONS).toHaveLength(PLATFORM_TYPES.length);
      for (const opt of PLATFORM_OPTIONS) {
        expect(opt).toHaveProperty("value");
        expect(opt).toHaveProperty("label");
        expect(PLATFORM_TYPES).toContain(opt.value);
      }
    });
  });

  describe("platformTypeSchema", () => {
    it("accepts valid platform types", () => {
      for (const platform of PLATFORM_TYPES) {
        expect(platformTypeSchema.parse(platform)).toBe(platform);
      }
    });

    it("rejects invalid platform types", () => {
      expect(() => platformTypeSchema.parse("facebook")).toThrow();
      expect(() => platformTypeSchema.parse("")).toThrow();
      expect(() => platformTypeSchema.parse(123)).toThrow();
    });
  });

  describe("FUNNEL_STAGES", () => {
    it("contains all stages in correct order", () => {
      expect(FUNNEL_STAGES).toEqual([
        "cold",
        "curious",
        "interested",
        "hot_lead",
        "buyer",
        "vip",
      ]);
    });
  });

  describe("funnelStageSchema", () => {
    it("accepts valid funnel stages", () => {
      for (const stage of FUNNEL_STAGES) {
        expect(funnelStageSchema.parse(stage)).toBe(stage);
      }
    });

    it("rejects invalid funnel stages", () => {
      expect(() => funnelStageSchema.parse("unknown")).toThrow();
      expect(() => funnelStageSchema.parse("")).toThrow();
    });
  });
});
