import { describe, it, expect, vi } from "vitest";
import { canAccessConversation, getConversationScope } from "@/server/api/access";

function makeCtx(opts: {
  teamRole: string | null;
  member?: { role: string; customRole?: { permissions: string[] } | null } | null;
  assignment?: { id: string } | undefined;
}) {
  const assignmentFind = vi.fn().mockResolvedValue(opts.assignment);
  const memberFind = vi.fn().mockResolvedValue(
    opts.member === undefined ? null : opts.member
  );
  const ctx = {
    db: {
      query: {
        conversationAssignments: { findFirst: assignmentFind },
        teamMembers: { findFirst: memberFind },
      },
    },
    teamRole: opts.teamRole,
    actingUserId: "u1",
    creatorId: "c1",
  };
  return { ctx, assignmentFind, memberFind };
}

describe("canAccessConversation (TEN-6 + roles personalizados)", () => {
  it("owner tiene acceso completo sin consultas", async () => {
    const { ctx, assignmentFind, memberFind } = makeCtx({ teamRole: null });
    expect(await canAccessConversation(ctx as any, "conv1")).toBe(true);
    expect(assignmentFind).not.toHaveBeenCalled();
    expect(memberFind).not.toHaveBeenCalled();
  });

  it("manager (read_all por defecto) accede sin consultar asignaciones", async () => {
    const { ctx, assignmentFind } = makeCtx({
      teamRole: "manager",
      member: { role: "manager", customRole: null },
    });
    expect(await canAccessConversation(ctx as any, "conv1")).toBe(true);
    expect(assignmentFind).not.toHaveBeenCalled();
  });

  it("chatter con asignación → acceso", async () => {
    const { ctx, assignmentFind } = makeCtx({
      teamRole: "chatter",
      member: { role: "chatter", customRole: null },
      assignment: { id: "a1" },
    });
    expect(await canAccessConversation(ctx as any, "conv1")).toBe(true);
    expect(assignmentFind).toHaveBeenCalledTimes(1);
  });

  it("chatter sin asignación → denegado", async () => {
    const { ctx } = makeCtx({
      teamRole: "chatter",
      member: { role: "chatter", customRole: null },
      assignment: undefined,
    });
    expect(await canAccessConversation(ctx as any, "conv1")).toBe(false);
  });

  it("rol personalizado con read_all da acceso completo a un chatter", async () => {
    const { ctx } = makeCtx({
      teamRole: "chatter",
      member: { role: "chatter", customRole: { permissions: ["conversations.read_all"] } },
    });
    expect(await getConversationScope(ctx as any)).toBe("all");
  });

  it("rol personalizado sin permisos de conversación → none", async () => {
    const { ctx } = makeCtx({
      teamRole: "manager",
      member: { role: "manager", customRole: { permissions: ["analytics.view"] } },
    });
    expect(await getConversationScope(ctx as any)).toBe("none");
    expect(await canAccessConversation(ctx as any, "conv1")).toBe(false);
  });

  it("miembro inactivo/inexistente → none", async () => {
    const { ctx } = makeCtx({ teamRole: "chatter", member: null });
    expect(await getConversationScope(ctx as any)).toBe("none");
  });
});
