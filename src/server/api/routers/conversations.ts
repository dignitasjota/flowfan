import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { conversations, contacts } from "@/server/db/schema";

export const conversationsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        contactId: z.string().uuid().optional(),
        status: z.enum(["active", "paused", "archived"]).optional(),
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

      return ctx.db.query.conversations.findMany({
        where: and(...conditions),
        with: {
          contact: { with: { profile: true } },
        },
        orderBy: [desc(conversations.lastMessageAt)],
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, input.id),
          eq(conversations.creatorId, ctx.creatorId)
        ),
        with: {
          contact: { with: { profile: true } },
          messages: { orderBy: (m, { asc }) => [asc(m.createdAt)] },
        },
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        contactId: z.string().uuid(),
        platformType: z.enum([
          "instagram",
          "tinder",
          "reddit",
          "onlyfans",
          "twitter",
          "telegram",
          "snapchat",
          "other",
        ]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [conversation] = await ctx.db
        .insert(conversations)
        .values({
          creatorId: ctx.creatorId,
          contactId: input.contactId,
          platformType: input.platformType,
        })
        .returning();

      // Increment total conversations on contact
      const contact = await ctx.db.query.contacts.findFirst({
        where: eq(contacts.id, input.contactId),
      });
      if (contact) {
        await ctx.db
          .update(contacts)
          .set({ totalConversations: contact.totalConversations + 1 })
          .where(eq(contacts.id, input.contactId));
      }

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
});
