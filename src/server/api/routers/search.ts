import { z } from "zod";
import { sql, and, eq, gte, lte, inArray } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  messages,
  conversations,
  contacts,
  conversationAssignments,
} from "@/server/db/schema";
import { platformTypeSchema } from "@/lib/constants";

export const searchRouter = createTRPCRouter({
  search: protectedProcedure
    .input(
      z.object({
        query: z.string().min(2).max(200),
        limit: z.number().min(1).max(50).default(20),
        offset: z.number().min(0).default(0),
        filters: z
          .object({
            platform: platformTypeSchema.optional(),
            role: z.enum(["fan", "creator"]).optional(),
            dateFrom: z.string().datetime().optional(),
            dateTo: z.string().datetime().optional(),
            contactId: z.string().uuid().optional(),
          })
          .optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const tsquery = sql`(plainto_tsquery('spanish', ${input.query}) || plainto_tsquery('english', ${input.query}))`;

      const conditions = [
        eq(conversations.creatorId, ctx.creatorId),
        sql`"messages".search_vector @@ ${tsquery}`,
      ];

      // Chatters only see their assigned conversations
      if (ctx.teamRole === "chatter") {
        conditions.push(
          inArray(
            conversations.id,
            sql`(SELECT ${conversationAssignments.conversationId} FROM ${conversationAssignments} WHERE ${conversationAssignments.assignedToUserId} = ${ctx.actingUserId})`
          )
        );
      }

      if (input.filters?.platform) {
        conditions.push(eq(conversations.platformType, input.filters.platform));
      }
      if (input.filters?.role) {
        conditions.push(eq(messages.role, input.filters.role));
      }
      if (input.filters?.dateFrom) {
        conditions.push(
          gte(messages.createdAt, new Date(input.filters.dateFrom))
        );
      }
      if (input.filters?.dateTo) {
        conditions.push(
          lte(messages.createdAt, new Date(input.filters.dateTo))
        );
      }
      if (input.filters?.contactId) {
        conditions.push(eq(conversations.contactId, input.filters.contactId));
      }

      const whereClause = and(...conditions);

      const [countResult] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(messages)
        .innerJoin(
          conversations,
          eq(messages.conversationId, conversations.id)
        )
        .where(whereClause);

      const total = countResult?.count ?? 0;

      const items = await ctx.db
        .select({
          messageId: messages.id,
          conversationId: messages.conversationId,
          contactId: conversations.contactId,
          contactUsername: contacts.username,
          contactDisplayName: contacts.displayName,
          platformType: conversations.platformType,
          role: messages.role,
          snippet: sql<string>`ts_headline('spanish', ${messages.content}, ${tsquery}, 'MaxWords=30, MinWords=10, StartSel=<mark>, StopSel=</mark>')`,
          relevanceScore: sql<number>`ts_rank("messages".search_vector, ${tsquery})`,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .innerJoin(
          conversations,
          eq(messages.conversationId, conversations.id)
        )
        .innerJoin(contacts, eq(conversations.contactId, contacts.id))
        .where(whereClause)
        .orderBy(sql`ts_rank("messages".search_vector, ${tsquery}) DESC`)
        .limit(input.limit)
        .offset(input.offset);

      return {
        items,
        total,
        hasMore: input.offset + input.limit < total,
      };
    }),
});
