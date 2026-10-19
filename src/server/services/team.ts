import crypto from "crypto";
import { eq, and, isNull } from "drizzle-orm";
import { teamMembers, teamInvites, creators } from "@/server/db/schema";
import { createChildLogger } from "@/lib/logger";

type Db = typeof import("@/server/db").db;

const log = createChildLogger("team-service");

export async function inviteTeamMember(
  db: Db,
  creatorId: string,
  email: string,
  role: "owner" | "manager" | "chatter"
) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const [invite] = await db
    .insert(teamInvites)
    .values({
      creatorId,
      email,
      role,
      token,
      expiresAt,
    })
    .returning();

  log.info({ creatorId, email, role }, "Team invite created");

  return invite!;
}

export async function acceptInvite(db: Db, token: string, userId: string) {
  const invite = await db.query.teamInvites.findFirst({
    where: eq(teamInvites.token, token),
  });

  if (!invite) {
    throw new Error("Invitación no encontrada");
  }

  if (invite.acceptedAt) {
    throw new Error("Esta invitación ya fue aceptada");
  }

  if (new Date() > invite.expiresAt) {
    throw new Error("La invitación ha caducado");
  }

  // La invitación es para un email concreto: antes cualquiera con el enlace
  // podía aceptarla con su propia cuenta.
  const user = await db.query.creators.findFirst({
    where: eq(creators.id, userId),
    columns: { email: true },
  });
  if (!user || user.email.trim().toLowerCase() !== invite.email.trim().toLowerCase()) {
    throw new Error("Esta invitación es para otra dirección de email. Inicia sesión con la cuenta invitada.");
  }
  if (invite.creatorId === userId) {
    throw new Error("No puedes unirte a tu propio equipo.");
  }

  return db.transaction(async (tx) => {
    // Claim atómico: dos aceptaciones simultáneas no crean dos membresías.
    const [claimed] = await tx
      .update(teamInvites)
      .set({ acceptedAt: new Date(), acceptedByUserId: userId })
      .where(and(eq(teamInvites.id, invite.id), isNull(teamInvites.acceptedAt)))
      .returning({ id: teamInvites.id });
    if (!claimed) throw new Error("Esta invitación ya fue aceptada");

    // Un miembro eliminado (isActive=false) se reactiva en vez de chocar con
    // el índice único (creatorId, userId).
    const [membership] = await tx
      .insert(teamMembers)
      .values({ creatorId: invite.creatorId, userId, role: invite.role })
      .onConflictDoUpdate({
        target: [teamMembers.creatorId, teamMembers.userId],
        set: {
          role: invite.role,
          isActive: true,
          customRoleId: null,
          joinedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();

    log.info({ userId, creatorId: invite.creatorId }, "Team invite accepted");
    return membership!;
  });
}

export async function removeMember(db: Db, creatorId: string, userId: string) {
  await db
    .update(teamMembers)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(teamMembers.creatorId, creatorId),
        eq(teamMembers.userId, userId)
      )
    );

  log.info({ creatorId, userId }, "Team member removed");
}

export async function getTeamsForUser(db: Db, userId: string) {
  const memberships = await db
    .select({
      id: teamMembers.id,
      creatorId: teamMembers.creatorId,
      role: teamMembers.role,
      joinedAt: teamMembers.joinedAt,
      creatorName: creators.name,
      creatorEmail: creators.email,
    })
    .from(teamMembers)
    .innerJoin(creators, eq(teamMembers.creatorId, creators.id))
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.isActive, true)
      )
    );

  return memberships;
}
