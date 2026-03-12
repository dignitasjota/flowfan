import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { contacts, contactProfiles } from "@/server/db/schema";

export const contactsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        platformType: z
          .enum([
            "instagram",
            "tinder",
            "reddit",
            "onlyfans",
            "twitter",
            "telegram",
            "snapchat",
            "other",
          ])
          .optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(contacts.creatorId, ctx.creatorId)];

      if (input?.platformType) {
        conditions.push(eq(contacts.platformType, input.platformType));
      }

      return ctx.db.query.contacts.findMany({
        where: and(...conditions),
        with: { profile: true },
        orderBy: [desc(contacts.lastInteractionAt)],
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.contacts.findFirst({
        where: and(
          eq(contacts.id, input.id),
          eq(contacts.creatorId, ctx.creatorId)
        ),
        with: {
          profile: true,
          conversations: true,
          notes: true,
        },
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        username: z.string().min(1).max(255),
        displayName: z.string().max(255).optional(),
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
      const [contact] = await ctx.db
        .insert(contacts)
        .values({
          creatorId: ctx.creatorId,
          username: input.username,
          displayName: input.displayName,
          platformType: input.platformType,
        })
        .returning();

      // Create empty profile
      await ctx.db.insert(contactProfiles).values({
        contactId: contact!.id,
      });

      return contact;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        displayName: z.string().max(255).optional(),
        tags: z.array(z.string()).optional(),
        isArchived: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [updated] = await ctx.db
        .update(contacts)
        .set(data)
        .where(and(eq(contacts.id, id), eq(contacts.creatorId, ctx.creatorId)))
        .returning();
      return updated;
    }),
});
