import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { conversations, conversationAssignments, contacts } from "@/server/db/schema";
import { resolveUserPermissions } from "@/server/services/permissions";

type AccessCtx = {
  db: typeof import("@/server/db").db;
  teamRole: string | null;
  actingUserId: string;
  creatorId: string;
};

/**
 * Alcance de lectura/escritura de conversaciones del usuario actual:
 * - "all": owner, cuenta propia o permiso `conversations.read_all`.
 * - "assigned": solo conversaciones asignadas (`conversations.read_assigned`).
 * - "none": ni lo uno ni lo otro (rol personalizado sin acceso a chats).
 *
 * TEN-6 + roles personalizados: antes el alcance dependía solo de
 * `teamRole === "chatter"`, así que los permisos granulares de los roles
 * personalizados nunca se aplicaban.
 */
export type ConversationScope = "all" | "assigned" | "none";

const scopeCache = new WeakMap<object, Promise<ConversationScope>>();

export function getConversationScope(ctx: AccessCtx): Promise<ConversationScope> {
  if (!ctx.teamRole || ctx.teamRole === "owner") return Promise.resolve("all");
  const cached = scopeCache.get(ctx);
  if (cached) return cached;
  const p = resolveUserPermissions(ctx.db, ctx.creatorId, ctx.actingUserId).then(
    (perms): ConversationScope =>
      perms.includes("conversations.read_all")
        ? "all"
        : perms.includes("conversations.read_assigned")
          ? "assigned"
          : "none"
  );
  scopeCache.set(ctx, p);
  return p;
}

/** ¿Puede el usuario acceder a esta conversación? (asume ownership ya verificado) */
export async function canAccessConversation(
  ctx: AccessCtx,
  conversationId: string
): Promise<boolean> {
  const scope = await getConversationScope(ctx);
  if (scope === "all") return true;
  if (scope === "none") return false;
  const assignment = await ctx.db.query.conversationAssignments.findFirst({
    where: and(
      eq(conversationAssignments.conversationId, conversationId),
      eq(conversationAssignments.assignedToUserId, ctx.actingUserId)
    ),
    columns: { id: true },
  });
  return !!assignment;
}

export async function assertCanAccessConversation(
  ctx: AccessCtx,
  conversationId: string
): Promise<void> {
  if (!(await canAccessConversation(ctx, conversationId))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tienes acceso a esta conversación",
    });
  }
}

function assignedContactIdsSubquery(actingUserId: string) {
  return sql`(SELECT ${conversations.contactId} FROM ${conversations} JOIN ${conversationAssignments} ON ${conversationAssignments.conversationId} = ${conversations.id} WHERE ${conversationAssignments.assignedToUserId} = ${actingUserId})`;
}

/** ¿Puede el usuario acceder a este contacto? (al menos una conversación asignada) */
export async function canAccessContact(ctx: AccessCtx, contactId: string): Promise<boolean> {
  const scope = await getConversationScope(ctx);
  if (scope === "all") return true;
  if (scope === "none") return false;
  const [row] = await ctx.db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(
      conversationAssignments,
      eq(conversationAssignments.conversationId, conversations.id)
    )
    .where(
      and(
        eq(conversations.contactId, contactId),
        eq(conversationAssignments.assignedToUserId, ctx.actingUserId)
      )
    )
    .limit(1);
  return !!row;
}

export async function assertCanAccessContact(ctx: AccessCtx, contactId: string): Promise<void> {
  if (!(await canAccessContact(ctx, contactId))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a este contacto" });
  }
}

/** Condición SQL que limita `contacts` al alcance del usuario (o undefined si ve todo). */
export async function contactScopeFilter(ctx: AccessCtx): Promise<SQL | undefined> {
  const scope = await getConversationScope(ctx);
  if (scope === "all") return undefined;
  if (scope === "none") return sql`false`;
  return inArray(contacts.id, assignedContactIdsSubquery(ctx.actingUserId));
}

/** Condición SQL que limita `conversations` al alcance del usuario (o undefined si ve todo). */
export async function conversationScopeFilter(ctx: AccessCtx): Promise<SQL | undefined> {
  const scope = await getConversationScope(ctx);
  if (scope === "all") return undefined;
  if (scope === "none") return sql`false`;
  return inArray(
    conversations.id,
    sql`(SELECT ${conversationAssignments.conversationId} FROM ${conversationAssignments} WHERE ${conversationAssignments.assignedToUserId} = ${ctx.actingUserId})`
  );
}

/** @deprecated usar `contactScopeFilter(ctx)` (respeta roles personalizados). */
export function chatterContactFilter(actingUserId: string) {
  return inArray(contacts.id, assignedContactIdsSubquery(actingUserId));
}
