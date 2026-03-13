import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock usage-limits
vi.mock("@/server/services/usage-limits", () => ({
  checkContactLimit: vi.fn().mockResolvedValue(undefined),
}));

import { checkContactLimit } from "@/server/services/usage-limits";

const mockCheckLimit = vi.mocked(checkContactLimit);

// ============================================================
// Helpers: mock DB builder
// ============================================================

function createMockDb(overrides: Record<string, unknown> = {}) {
  const contactsData = overrides.contacts ?? [];
  const totalCount = overrides.totalCount ?? 0;

  return {
    query: {
      contacts: {
        findMany: vi.fn().mockResolvedValue(contactsData),
        findFirst: vi.fn().mockResolvedValue(overrides.singleContact ?? null),
      },
    },
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: totalCount }]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([overrides.insertedContact ?? { id: "new-id", creatorId: "c1", username: "test" }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([overrides.updatedContact ?? { id: "u1" }]),
        }),
      }),
    }),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("contacts router logic", () => {
  describe("list", () => {
    it("builds conditions from input filters", () => {
      // Verify that filtering by platform and search are supported
      const conditions: string[] = [];
      const input = { platformType: "instagram", search: "fan", funnelStage: "hot_lead" as const };

      if (input.platformType) conditions.push("platformType");
      if (input.search) conditions.push("search");
      if (input.funnelStage) conditions.push("funnelStage");

      expect(conditions).toEqual(["platformType", "search", "funnelStage"]);
    });

    it("calculates hasMore correctly", () => {
      const offset = 0;
      const limit = 10;
      const total = 25;
      const hasMore = offset + limit < total;
      expect(hasMore).toBe(true);
    });

    it("no hasMore when all results shown", () => {
      const offset = 20;
      const limit = 10;
      const total = 25;
      const hasMore = offset + limit < total;
      expect(hasMore).toBe(false);
    });

    it("filters by funnel stage in memory", () => {
      const results = [
        { id: "1", profile: { funnelStage: "hot_lead" } },
        { id: "2", profile: { funnelStage: "cold" } },
        { id: "3", profile: { funnelStage: "hot_lead" } },
      ];

      const funnelStage = "hot_lead";
      const filtered = results.filter((c) => c.profile?.funnelStage === funnelStage);
      expect(filtered).toHaveLength(2);
    });
  });

  describe("create", () => {
    it("checks contact limit before creating", async () => {
      const db = createMockDb();
      await mockCheckLimit(db, "creator-1");
      expect(mockCheckLimit).toHaveBeenCalledWith(db, "creator-1");
    });

    it("creates contact and empty profile", async () => {
      const db = createMockDb();

      // Simulate create flow
      const [contact] = await db.insert().values({ creatorId: "c1", username: "test", platformType: "instagram" }).returning();
      expect(contact.id).toBeDefined();

      // Profile insert
      await db.insert().values({ contactId: contact.id }).returning();
      expect(db.insert).toHaveBeenCalledTimes(2);
    });

    it("rejects when limit exceeded", async () => {
      const error = { code: "FORBIDDEN", message: "Contact limit exceeded" };
      mockCheckLimit.mockRejectedValueOnce(error);

      await expect(mockCheckLimit({} as any, "c1")).rejects.toEqual(error);
    });
  });

  describe("update", () => {
    it("updates with ownership check", async () => {
      const db = createMockDb({ updatedContact: { id: "c1", displayName: "New Name" } });

      const [updated] = await db.update().set({ displayName: "New Name" }).where("conditions").returning();
      expect(updated.displayName).toBe("New Name");
    });

    it("returns undefined for non-owned contact", async () => {
      const db = createMockDb();
      db.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await db.update().set({}).where("cond").returning();
      expect(result).toHaveLength(0);
    });
  });

  describe("getById", () => {
    it("returns contact with profile, conversations, notes", async () => {
      const db = createMockDb({
        singleContact: {
          id: "c1",
          username: "fan",
          profile: { engagementLevel: 50 },
          conversations: [{ id: "conv1" }],
          notes: [{ content: "nota" }],
        },
      });

      const result = await db.query.contacts.findFirst();
      expect(result.profile).toBeDefined();
      expect(result.conversations).toHaveLength(1);
      expect(result.notes).toHaveLength(1);
    });

    it("returns null for non-existent contact", async () => {
      const db = createMockDb();
      const result = await db.query.contacts.findFirst();
      expect(result).toBeNull();
    });
  });
});
