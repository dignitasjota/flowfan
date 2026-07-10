import { and, eq, inArray, sql } from "drizzle-orm";
import { conversations, conversationAssignments, contacts } from "@/server/db/schema";

type AccessCtx = {
  db: any;
  teamRole: string | null;
  actingUserId: string;
};

/**
 * TEN-6: ¿puede el usuario acceder a esta conversación?
 *
 * Owners y managers tienen acceso completo (las queries ya están scopeadas por
 * `creatorId` aguas arriba). Los chatters solo pueden acceder a conversaciones
 * que les han sido asignadas — tanto para leer como para escribir mensajes.
 */
export async function canAccessConversation(
  ctx: AccessCtx,
  conversationId: string
): Promise<boolean> {
  if (ctx.teamRole !== "chatter") return true;
  const assignment = await ctx.db.query.conversationAssignments.findFirst({
    where: and(
      eq(conversationAssignments.conversationId, conversationId),
      eq(conversationAssignments.assignedToUserId, ctx.actingUserId)
    ),
    columns: { id: true },
  });
  return !!assignment;
}

/**
 * TEN-6: condición SQL que limita los contactos visibles a un chatter — solo
 * aquellos con al menos una conversación asignada a él. Aplicar a las queries
 * de `contacts` cuando `ctx.teamRole === "chatter"`.
 */
export function chatterContactFilter(actingUserId: string) {
  return inArray(
    contacts.id,
    sql`(SELECT ${conversations.contactId} FROM ${conversations} JOIN ${conversationAssignments} ON ${conversationAssignments.conversationId} = ${conversations.id} WHERE ${conversationAssignments.assignedToUserId} = ${actingUserId})`
  );
}
