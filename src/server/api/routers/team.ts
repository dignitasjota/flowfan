import { z } from "zod";
import { eq, and, isNull, gt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  ownerProcedure,
  managerProcedure,
} from "../trpc";
import { createChildLogger } from "@/lib/logger";
import {
  teamMembers,
  teamInvites,
  conversationAssignments,
  creators,
  conversations,
} from "@/server/db/schema";
import { checkTeamMemberLimit, checkAssignmentAccess } from "@/server/services/usage-limits";
import {
  inviteTeamMember,
  acceptInvite,
  removeMember,
  getTeamsForUser,
} from "@/server/services/team";

const log = createChildLogger("team-router");

export const teamRouter = createTRPCRouter({
  // 1. List active team members
  getMembers: protectedProcedure.query(async ({ ctx }) => {
    const members = await ctx.db
      .select({
        id: teamMembers.id,
        userId: teamMembers.userId,
        role: teamMembers.role,
        joinedAt: teamMembers.joinedAt,
        userName: creators.name,
        userEmail: creators.email,
      })
      .from(teamMembers)
      .innerJoin(creators, eq(teamMembers.userId, creators.id))
      .where(
        and(
          eq(teamMembers.creatorId, ctx.creatorId),
          eq(teamMembers.isActive, true)
        )
      );

    return members;
  }),

  // 2. Invite a team member
  invite: ownerProcedure
    .input(
      z.object({
        email: z.string().email(),
        role: z.enum(["manager", "chatter"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkTeamMemberLimit(ctx.db, ctx.creatorId);

      // Verify email is not the owner's email
      const owner = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, ctx.creatorId),
        columns: { email: true },
      });

      if (owner?.email === input.email) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No puedes invitarte a ti mismo.",
        });
      }

      // Verify no active membership already exists for this email
      const existingUser = await ctx.db.query.creators.findFirst({
        where: eq(creators.email, input.email),
        columns: { id: true },
      });

      if (existingUser) {
        const existingMembership = await ctx.db.query.teamMembers.findFirst({
          where: and(
            eq(teamMembers.creatorId, ctx.creatorId),
            eq(teamMembers.userId, existingUser.id),
            eq(teamMembers.isActive, true)
          ),
        });

        if (existingMembership) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Este usuario ya es miembro del equipo.",
          });
        }
      }

      const invite = await inviteTeamMember(ctx.db, ctx.creatorId, input.email, input.role);

      log.info({ creatorId: ctx.creatorId, email: input.email, role: input.role }, "Team invite sent");

      return {
        ...invite,
        inviteLink: `/team/accept?token=${invite.token}`,
      };
    }),

  // 3. Revoke an invite
  revokeInvite: ownerProcedure
    .input(z.object({ inviteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(teamInvites)
        .where(
          and(
            eq(teamInvites.id, input.inviteId),
            eq(teamInvites.creatorId, ctx.creatorId)
          )
        );

      return { success: true };
    }),

  // 4. List pending invites
  getPendingInvites: ownerProcedure.query(async ({ ctx }) => {
    const pending = await ctx.db
      .select()
      .from(teamInvites)
      .where(
        and(
          eq(teamInvites.creatorId, ctx.creatorId),
          isNull(teamInvites.acceptedAt),
          gt(teamInvites.expiresAt, new Date())
        )
      );

    return pending;
  }),

  // 5. Remove a team member
  removeMember: ownerProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await removeMember(ctx.db, ctx.creatorId, input.userId);
      return { success: true };
    }),

  // 6. Update member role
  updateMemberRole: ownerProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        role: z.enum(["manager", "chatter"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(teamMembers)
        .set({ role: input.role, updatedAt: new Date() })
        .where(
          and(
            eq(teamMembers.creatorId, ctx.creatorId),
            eq(teamMembers.userId, input.userId),
            eq(teamMembers.isActive, true)
          )
        );

      return { success: true };
    }),

  // 7. Accept an invite
  acceptInvite: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const membership = await acceptInvite(ctx.db, input.token, ctx.actingUserId);
        return membership;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Error al aceptar invitación";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),

  // 8. Get my teams
  getMyTeams: protectedProcedure.query(async ({ ctx }) => {
    const teams = await getTeamsForUser(ctx.db, ctx.actingUserId);
    return teams;
  }),

  // 9. Switch team
  switchTeam: protectedProcedure
    .input(z.object({ creatorId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Validate membership exists and is active
      const membership = await ctx.db.query.teamMembers.findFirst({
        where: and(
          eq(teamMembers.creatorId, input.creatorId),
          eq(teamMembers.userId, ctx.actingUserId),
          eq(teamMembers.isActive, true)
        ),
      });

      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No eres miembro activo de este equipo.",
        });
      }

      return {
        activeCreatorId: input.creatorId,
        teamRole: membership.role,
      };
    }),

  // 10. Assign conversation
  assignConversation: managerProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        userId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkAssignmentAccess(ctx.db, ctx.creatorId);

      // Verify conversation belongs to ctx.creatorId
      const conversation = await ctx.db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, input.conversationId),
          eq(conversations.creatorId, ctx.creatorId)
        ),
      });

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversación no encontrada.",
        });
      }

      // Verify userId is active team member
      const member = await ctx.db.query.teamMembers.findFirst({
        where: and(
          eq(teamMembers.creatorId, ctx.creatorId),
          eq(teamMembers.userId, input.userId),
          eq(teamMembers.isActive, true)
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El usuario no es un miembro activo del equipo.",
        });
      }

      // Upsert assignment
      const [assignment] = await ctx.db
        .insert(conversationAssignments)
        .values({
          conversationId: input.conversationId,
          assignedToUserId: input.userId,
          assignedByUserId: ctx.actingUserId,
        })
        .onConflictDoUpdate({
          target: [conversationAssignments.conversationId, conversationAssignments.assignedToUserId],
          set: {
            assignedByUserId: ctx.actingUserId,
            createdAt: new Date(),
          },
        })
        .returning();

      log.info(
        { conversationId: input.conversationId, userId: input.userId, assignedBy: ctx.actingUserId },
        "Conversation assigned"
      );

      return assignment;
    }),

  // 11. Unassign conversation
  unassignConversation: managerProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        userId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(conversationAssignments)
        .where(
          and(
            eq(conversationAssignments.conversationId, input.conversationId),
            eq(conversationAssignments.assignedToUserId, input.userId)
          )
        );

      return { success: true };
    }),

  // 12. Get assignments
  getAssignments: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      if (input?.conversationId) {
        // Get assignments for a specific conversation
        const assignments = await ctx.db
          .select({
            id: conversationAssignments.id,
            conversationId: conversationAssignments.conversationId,
            assignedToUserId: conversationAssignments.assignedToUserId,
            assignedByUserId: conversationAssignments.assignedByUserId,
            createdAt: conversationAssignments.createdAt,
            assigneeName: creators.name,
            assigneeEmail: creators.email,
          })
          .from(conversationAssignments)
          .innerJoin(creators, eq(conversationAssignments.assignedToUserId, creators.id))
          .where(eq(conversationAssignments.conversationId, input.conversationId));

        return assignments;
      }

      // Get all assignments for the team (no specific conversation)
      const assignments = await ctx.db
        .select({
          id: conversationAssignments.id,
          conversationId: conversationAssignments.conversationId,
          assignedToUserId: conversationAssignments.assignedToUserId,
          assignedByUserId: conversationAssignments.assignedByUserId,
          createdAt: conversationAssignments.createdAt,
          assigneeName: creators.name,
          assigneeEmail: creators.email,
        })
        .from(conversationAssignments)
        .innerJoin(creators, eq(conversationAssignments.assignedToUserId, creators.id))
        .innerJoin(conversations, eq(conversationAssignments.conversationId, conversations.id))
        .where(eq(conversations.creatorId, ctx.creatorId));

      return assignments;
    }),
});
