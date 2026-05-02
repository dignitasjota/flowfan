import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/schema", () => ({
  teamAuditLog: {
    id: "id",
    creatorId: "creator_id",
    userId: "user_id",
    userName: "user_name",
    action: "action",
    entityType: "entity_type",
    entityId: "entity_id",
    details: "details",
    createdAt: "created_at",
  },
}));

const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

const mockDb = {
  insert: mockInsert,
} as any;

import { logTeamAction } from "@/server/services/team-audit";

describe("team-audit", () => {
  beforeEach(() => {
    mockInsert.mockClear();
    mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  });

  it("inserts an audit log entry with all fields", async () => {
    const valuesFn = vi.fn().mockResolvedValue(undefined);
    mockInsert.mockReturnValue({ values: valuesFn });

    await logTeamAction(mockDb, {
      creatorId: "creator-1",
      userId: "user-1",
      userName: "Test User",
      action: "contact.created",
      entityType: "contact",
      entityId: "contact-1",
      details: { username: "fan123" },
    });

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(valuesFn).toHaveBeenCalledWith({
      creatorId: "creator-1",
      userId: "user-1",
      userName: "Test User",
      action: "contact.created",
      entityType: "contact",
      entityId: "contact-1",
      details: { username: "fan123" },
    });
  });

  it("defaults details to empty object when not provided", async () => {
    const valuesFn = vi.fn().mockResolvedValue(undefined);
    mockInsert.mockReturnValue({ values: valuesFn });

    await logTeamAction(mockDb, {
      creatorId: "creator-1",
      userId: "user-1",
      userName: "Test User",
      action: "member.removed",
      entityType: "team_member",
    });

    expect(valuesFn).toHaveBeenCalledWith(
      expect.objectContaining({ details: {} })
    );
  });

  it("does not throw when db insert fails", async () => {
    mockInsert.mockReturnValue({
      values: vi.fn().mockRejectedValue(new Error("DB error")),
    });

    // Should not throw
    await expect(
      logTeamAction(mockDb, {
        creatorId: "creator-1",
        userId: "user-1",
        userName: "Test User",
        action: "role.created",
        entityType: "role",
      })
    ).resolves.toBeUndefined();
  });
});
