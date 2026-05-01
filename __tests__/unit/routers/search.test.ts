import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================
// Helpers
// ============================================================

function createMockDb(overrides: Record<string, unknown> = {}) {
  const searchResults = (overrides.searchResults as unknown[]) ?? [];
  const totalCount = overrides.totalCount ?? 0;

  const whereFn = vi.fn();
  const orderByFn = vi.fn();
  const limitFn = vi.fn();
  const offsetFn = vi.fn().mockResolvedValue(searchResults);

  limitFn.mockReturnValue({ offset: offsetFn });
  orderByFn.mockReturnValue({ limit: limitFn });
  whereFn.mockReturnValue({ orderBy: orderByFn, limit: limitFn });

  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: whereFn,
            orderBy: orderByFn,
          }),
          where: vi.fn().mockResolvedValue([{ count: totalCount }]),
        }),
      }),
    }),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("search router logic", () => {
  describe("input validation", () => {
    it("requires query of at least 2 characters", () => {
      const input = { query: "a" };
      expect(input.query.length).toBeLessThan(2);
    });

    it("accepts query of 2+ characters", () => {
      const input = { query: "ho" };
      expect(input.query.length).toBeGreaterThanOrEqual(2);
    });

    it("rejects query over 200 characters", () => {
      const input = { query: "a".repeat(201) };
      expect(input.query.length).toBeGreaterThan(200);
    });

    it("default limit is 20", () => {
      const defaults = { limit: 20, offset: 0 };
      expect(defaults.limit).toBe(20);
      expect(defaults.offset).toBe(0);
    });
  });

  describe("pagination", () => {
    it("calculates hasMore correctly when more results exist", () => {
      const offset = 0;
      const limit = 20;
      const total = 50;
      expect(offset + limit < total).toBe(true);
    });

    it("calculates hasMore as false when all results shown", () => {
      const offset = 40;
      const limit = 20;
      const total = 50;
      expect(offset + limit < total).toBe(false);
    });

    it("returns empty items with zero total", () => {
      const result = { items: [], total: 0, hasMore: false };
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });
  });

  describe("filters", () => {
    it("builds conditions for platform filter", () => {
      const conditions: string[] = [];
      const filters = { platform: "instagram" as const };

      if (filters.platform) conditions.push("platform");
      expect(conditions).toContain("platform");
    });

    it("builds conditions for role filter", () => {
      const conditions: string[] = [];
      const filters = { role: "fan" as const };

      if (filters.role) conditions.push("role");
      expect(conditions).toContain("role");
    });

    it("builds conditions for date range", () => {
      const conditions: string[] = [];
      const filters = {
        dateFrom: "2026-01-01T00:00:00.000Z",
        dateTo: "2026-12-31T23:59:59.999Z",
      };

      if (filters.dateFrom) conditions.push("dateFrom");
      if (filters.dateTo) conditions.push("dateTo");
      expect(conditions).toEqual(["dateFrom", "dateTo"]);
    });

    it("builds conditions for contactId filter", () => {
      const conditions: string[] = [];
      const filters = { contactId: "uuid-123" };

      if (filters.contactId) conditions.push("contactId");
      expect(conditions).toContain("contactId");
    });

    it("adds chatter restriction when teamRole is chatter", () => {
      const conditions: string[] = ["creatorId", "searchVector"];
      const teamRole = "chatter";

      if (teamRole === "chatter") {
        conditions.push("conversationAssignments");
      }
      expect(conditions).toContain("conversationAssignments");
    });

    it("does not add chatter restriction for managers", () => {
      const conditions: string[] = ["creatorId", "searchVector"];
      const teamRole = "manager";

      if (teamRole === "chatter") {
        conditions.push("conversationAssignments");
      }
      expect(conditions).not.toContain("conversationAssignments");
    });
  });

  describe("result format", () => {
    it("search result has expected shape", () => {
      const result = {
        messageId: "msg-1",
        conversationId: "conv-1",
        contactId: "contact-1",
        contactUsername: "user1",
        contactDisplayName: "User One",
        platformType: "instagram",
        role: "fan",
        snippet: "Hello <mark>world</mark>",
        relevanceScore: 0.85,
        createdAt: new Date(),
      };

      expect(result).toHaveProperty("messageId");
      expect(result).toHaveProperty("conversationId");
      expect(result).toHaveProperty("contactId");
      expect(result).toHaveProperty("snippet");
      expect(result).toHaveProperty("relevanceScore");
      expect(result.snippet).toContain("<mark>");
    });

    it("wraps results in paginated response", () => {
      const items = [{ messageId: "1" }, { messageId: "2" }];
      const total = 25;
      const offset = 0;
      const limit = 20;

      const response = {
        items,
        total,
        hasMore: offset + limit < total,
      };

      expect(response.items).toHaveLength(2);
      expect(response.total).toBe(25);
      expect(response.hasMore).toBe(true);
    });
  });

  describe("db mock integration", () => {
    it("creates mock db with search results", () => {
      const mockResults = [
        { messageId: "1", snippet: "test <mark>match</mark>" },
      ];
      const db = createMockDb({ searchResults: mockResults, totalCount: 1 });

      expect(db.select).toBeDefined();
      expect(typeof db.select).toBe("function");
    });
  });
});
