import { describe, it, expect, vi } from "vitest";
import { canAccessConversation } from "@/server/api/access";

describe("canAccessConversation (TEN-6)", () => {
  it("owner tiene acceso completo sin consultar asignaciones", async () => {
    const findFirst = vi.fn();
    const ctx = {
      db: { query: { conversationAssignments: { findFirst } } },
      teamRole: null,
      actingUserId: "u1",
    };
    expect(await canAccessConversation(ctx as any, "conv1")).toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("manager tiene acceso completo sin consultar asignaciones", async () => {
    const findFirst = vi.fn();
    const ctx = {
      db: { query: { conversationAssignments: { findFirst } } },
      teamRole: "manager",
      actingUserId: "u1",
    };
    expect(await canAccessConversation(ctx as any, "conv1")).toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("chatter con asignación → acceso", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "a1" });
    const ctx = {
      db: { query: { conversationAssignments: { findFirst } } },
      teamRole: "chatter",
      actingUserId: "u1",
    };
    expect(await canAccessConversation(ctx as any, "conv1")).toBe(true);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it("chatter sin asignación → denegado", async () => {
    const findFirst = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      db: { query: { conversationAssignments: { findFirst } } },
      teamRole: "chatter",
      actingUserId: "u1",
    };
    expect(await canAccessConversation(ctx as any, "conv1")).toBe(false);
  });
});
