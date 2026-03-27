import { z } from "zod";
import { eq, and, desc, ilike, or, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { conversations, contacts, conversationAssignments } from "@/server/db/schema";
import { platformTypeSchema } from "@/lib/constants";

export const conversationsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        contactId: z.string().uuid().optional(),
        status: z.enum(["active", "paused", "archived"]).optional(),
        search: z.string().max(100).optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(conversations.creatorId, ctx.creatorId)];

      if (input?.contactId) {
        conditions.push(eq(conversations.contactId, input.contactId));
      }
      if (input?.status) {
        conditions.push(eq(conversations.status, input.status));
      }

      // Chatters only see their assigned conversations
      if (ctx.teamRole === "chatter") {
        conditions.push(
          inArray(
            conversations.id,
            sql`(SELECT ${conversationAssignments.conversationId} FROM ${conversationAssignments} WHERE ${conversationAssignments.assignedToUserId} = ${ctx.actingUserId})`
          )
        );
      }

      const results = await ctx.db.query.conversations.findMany({
        where: and(...conditions),
        with: {
          contact: { with: { profile: true } },
        },
        orderBy: [desc(conversations.lastMessageAt)],
      });

      // Filter by contact search in-memory (contact is a relation)
      if (input?.search) {
        const term = input.search.toLowerCase();
        return results.filter(
          (c) =>
            c.contact.username.toLowerCase().includes(term) ||
            c.contact.displayName?.toLowerCase().includes(term)
        );
      }

      return results;
    }),

  getById: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        messageLimit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const conversation = await ctx.db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, input.id),
          eq(conversations.creatorId, ctx.creatorId)
        ),
        with: {
          contact: { with: { profile: true } },
        },
      });

      if (!conversation) return null;

      // Load messages with limit (most recent first, then reverse for display)
      const { messages: messagesTable } = await import("@/server/db/schema");
      const { eq: eqOp, desc: descOp, count: countFn } = await import("drizzle-orm");

      const allMessages = await ctx.db.query.messages.findMany({
        where: eqOp(messagesTable.conversationId, input.id),
        orderBy: (m, { desc }) => [desc(m.createdAt)],
        limit: input.messageLimit,
      });

      const [totalResult] = await ctx.db
        .select({ count: countFn() })
        .from(messagesTable)
        .where(eqOp(messagesTable.conversationId, input.id));

      return {
        ...conversation,
        messages: allMessages.reverse(),
        totalMessages: totalResult?.count ?? 0,
        hasMoreMessages: (totalResult?.count ?? 0) > input.messageLimit,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        contactId: z.string().uuid(),
        platformType: platformTypeSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify the contact belongs to this creator
      const contact = await ctx.db.query.contacts.findFirst({
        where: and(
          eq(contacts.id, input.contactId),
          eq(contacts.creatorId, ctx.creatorId)
        ),
      });

      if (!contact) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Contacto no encontrado",
        });
      }

      const [conversation] = await ctx.db
        .insert(conversations)
        .values({
          creatorId: ctx.creatorId,
          contactId: input.contactId,
          platformType: input.platformType,
        })
        .returning();

      // Increment total conversations on contact (already verified above)
      await ctx.db
        .update(contacts)
        .set({ totalConversations: contact.totalConversations + 1 })
        .where(eq(contacts.id, input.contactId));

      return conversation;
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(["active", "paused", "archived"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(conversations)
        .set({ status: input.status })
        .where(
          and(
            eq(conversations.id, input.id),
            eq(conversations.creatorId, ctx.creatorId)
          )
        )
        .returning();
      return updated;
    }),

  togglePin: protectedProcedure
    .input(z.object({ id: z.string().uuid(), isPinned: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(conversations)
        .set({ isPinned: input.isPinned })
        .where(
          and(
            eq(conversations.id, input.id),
            eq(conversations.creatorId, ctx.creatorId)
          )
        )
        .returning();
      return updated;
    }),
});
