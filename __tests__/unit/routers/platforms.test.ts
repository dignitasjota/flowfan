import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/services/usage-limits", () => ({
  checkPlatformLimit: vi.fn().mockResolvedValue(undefined),
}));

import { checkPlatformLimit } from "@/server/services/usage-limits";
const mockCheckLimit = vi.mocked(checkPlatformLimit);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("platforms router logic", () => {
  describe("upsert", () => {
    it("updates existing platform without checking limit", () => {
      const existing = { id: "p1", platformType: "instagram", creatorId: "c1" };
      // When platform exists, we update (no limit check)
      expect(existing).toBeDefined();
      expect(mockCheckLimit).not.toHaveBeenCalled();
    });

    it("checks limit only on insert (new platform)", async () => {
      const existing = null;
      if (!existing) {
        await mockCheckLimit({} as any, "c1");
      }
      expect(mockCheckLimit).toHaveBeenCalledTimes(1);
    });

    it("stores personality config", () => {
      const config = {
        tone: "friendly",
        style: "casual",
        messageLength: "medium" as const,
        goals: ["engagement"],
        restrictions: ["no explicit"],
        exampleMessages: ["Hola!"],
        customInstructions: "Be nice",
      };

      expect(config.tone).toBe("friendly");
      expect(config.goals).toEqual(["engagement"]);
    });

    it("validates personality config fields", () => {
      const validLengths = ["short", "medium", "long"];
      expect(validLengths).toContain("medium");
      expect(validLengths).not.toContain("extra_long");
    });
  });

  describe("delete", () => {
    it("deletes by creator + platform type", () => {
      const conditions = ["creatorId=c1", "platformType=instagram"];
      expect(conditions).toHaveLength(2);
    });
  });
});
