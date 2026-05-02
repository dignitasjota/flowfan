import { z } from "zod";
import { eq, and, desc, ilike, or, sql, count } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, managerProcedure } from "../trpc";
import { contacts, contactProfiles, fanTransactions } from "@/server/db/schema";
import { checkContactLimit } from "@/server/services/usage-limits";
import { workflowQueue } from "@/server/queues";
import { platformTypeSchema, funnelStageSchema } from "@/lib/constants";
import { scrapeInstagramProfile } from "@/server/services/instagram-scraper";
import { createChildLogger } from "@/lib/logger";
import { dispatchWebhookEvent } from "@/server/services/webhook-dispatcher";
import { logTeamAction } from "@/server/services/team-audit";

const log = createChildLogger("contacts-router");

export const contactsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        platformType: platformTypeSchema.optional(),
        search: z.string().max(100).optional(),
        funnelStage: funnelStageSchema
          .optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(contacts.creatorId, ctx.creatorId)];

      if (input?.platformType) {
        conditions.push(eq(contacts.platformType, input.platformType));
      }

      if (input?.search) {
        const searchTerm = `%${input.search}%`;
        conditions.push(
          or(
            ilike(contacts.username, searchTerm),
            ilike(contacts.displayName, searchTerm)
          )!
        );
      }

      // Get total count for pagination
      const [totalResult] = await ctx.db
        .select({ count: count() })
        .from(contacts)
        .where(and(...conditions));

      const results = await ctx.db.query.contacts.findMany({
        where: and(...conditions),
        with: { profile: true },
        orderBy: [desc(contacts.lastInteractionAt)],
        limit: input?.limit ?? 50,
        offset: input?.offset ?? 0,
      });

      // Filter by funnel stage in-memory (profile is a relation)
      const filtered = input?.funnelStage
        ? results.filter((c) => c.profile?.funnelStage === input.funnelStage)
        : results;

      return {
        items: filtered,
        total: totalResult?.count ?? 0,
        hasMore: (input?.offset ?? 0) + (input?.limit ?? 50) < (totalResult?.count ?? 0),
      };
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

  create: managerProcedure
    .input(
      z.object({
        username: z.string().min(1).max(255),
        displayName: z.string().max(255).optional(),
        avatarUrl: z.string().optional(),
        platformType: platformTypeSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkContactLimit(ctx.db, ctx.creatorId);

      const [contact] = await ctx.db
        .insert(contacts)
        .values({
          creatorId: ctx.creatorId,
          username: input.username,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
          platformType: input.platformType,
        })
        .returning();

      // Create empty profile
      await ctx.db.insert(contactProfiles).values({
        contactId: contact!.id,
      });

      // Dispatch workflow event for new contact
      try {
        await workflowQueue.add("new_contact", {
          type: "new_contact",
          creatorId: ctx.creatorId,
          contactId: contact!.id,
          platformType: input.platformType,
        });
      } catch {
        // Non-critical: workflow event dispatch failure shouldn't block contact creation
      }

      // Dispatch webhook: contact.created
      dispatchWebhookEvent(ctx.db, ctx.creatorId, "contact.created", {
        contactId: contact!.id,
        username: input.username,
        platformType: input.platformType,
      }).catch(() => {});

      // Background instagram scraping if missing info
      if (input.platformType === "instagram" && (!input.avatarUrl || !input.displayName)) {
        scrapeInstagramProfile(input.username, contact!.id)
          .then(async (scraped) => {
            const updates: Partial<{ avatarUrl: string; displayName: string }> = {};
            if (scraped.avatarUrl && !input.avatarUrl) updates.avatarUrl = scraped.avatarUrl;
            if (scraped.displayName && !input.displayName) updates.displayName = scraped.displayName;

            if (Object.keys(updates).length > 0) {
              await ctx.db
                .update(contacts)
                .set(updates)
                .where(eq(contacts.id, contact!.id));
            }
          })
          .catch((err) => log.error({ err }, "Instagram Scraper background error"));
      }

      logTeamAction(ctx.db, {
        creatorId: ctx.creatorId,
        userId: ctx.actingUserId,
        userName: ctx.session!.user.name ?? "Unknown",
        action: "contact.created",
        entityType: "contact",
        entityId: contact!.id,
        details: { username: input.username, platformType: input.platformType },
      });

      return contact;
    }),

  update: managerProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        displayName: z.string().max(255).optional(),
        avatarUrl: z.string().optional(),
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

      logTeamAction(ctx.db, {
        creatorId: ctx.creatorId,
        userId: ctx.actingUserId,
        userName: ctx.session!.user.name ?? "Unknown",
        action: "contact.updated",
        entityType: "contact",
        entityId: id,
        details: { changes: data },
      });

      return updated;
    }),

  delete: managerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const contact = await ctx.db.query.contacts.findFirst({
        where: and(
          eq(contacts.id, input.id),
          eq(contacts.creatorId, ctx.creatorId)
        ),
      });

      if (!contact) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contacto no encontrado." });
      }

      // Check if contact has any transactions
      const [txResult] = await ctx.db
        .select({ count: count() })
        .from(fanTransactions)
        .where(
          and(
            eq(fanTransactions.contactId, input.id),
            eq(fanTransactions.creatorId, ctx.creatorId)
          )
        );

      const hasPaid = (txResult?.count ?? 0) > 0;

      if (hasPaid) {
        // Archive instead of deleting
        await ctx.db
          .update(contacts)
          .set({ isArchived: true })
          .where(eq(contacts.id, input.id));
        return { action: "archived" as const, reason: "has_transactions" };
      }

      // Hard delete (cascade will remove profile, conversations, messages, notes)
      await ctx.db
        .delete(contacts)
        .where(eq(contacts.id, input.id));

      logTeamAction(ctx.db, {
        creatorId: ctx.creatorId,
        userId: ctx.actingUserId,
        userName: ctx.session!.user.name ?? "Unknown",
        action: "contact.deleted",
        entityType: "contact",
        entityId: input.id,
        details: { username: contact.username },
      });

      return { action: "deleted" as const, reason: null };
    }),
});
