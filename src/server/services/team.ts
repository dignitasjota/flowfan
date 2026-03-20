import crypto from "crypto";
import { eq, and } from "drizzle-orm";
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
    throw new Error("Invite not found");
  }

  if (invite.acceptedAt) {
    throw new Error("Invite already accepted");
  }

  if (new Date() > invite.expiresAt) {
    throw new Error("Invite has expired");
  }

  // Create team membership
  const [membership] = await db
    .insert(teamMembers)
    .values({
      creatorId: invite.creatorId,
      userId,
      role: invite.role,
    })
    .returning();

  // Mark invite as accepted
  await db
    .update(teamInvites)
    .set({
      acceptedAt: new Date(),
      acceptedByUserId: userId,
    })
    .where(eq(teamInvites.id, invite.id));

  log.info({ token, userId, creatorId: invite.creatorId }, "Team invite accepted");

  return membership!;
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
