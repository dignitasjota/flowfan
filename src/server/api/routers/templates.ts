import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { responseTemplates } from "@/server/db/schema";
import { checkTemplateLimit } from "@/server/services/usage-limits";

export const templatesRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        platformType: z.string().optional(),
        category: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const all = await ctx.db.query.responseTemplates.findMany({
        where: eq(responseTemplates.creatorId, ctx.creatorId),
        orderBy: [desc(responseTemplates.usageCount)],
      });

      let filtered = all;
      if (input.platformType) {
        filtered = filtered.filter(
          (t) => !t.platformType || t.platformType === input.platformType
        );
      }
      if (input.category) {
        filtered = filtered.filter((t) => t.category === input.category);
      }

      return filtered;
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const template = await ctx.db.query.responseTemplates.findFirst({
        where: and(
          eq(responseTemplates.id, input.id),
          eq(responseTemplates.creatorId, ctx.creatorId)
        ),
      });

      if (!template) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template no encontrado" });
      }

      return template;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        content: z.string().min(1),
        category: z.string().max(100).optional(),
        platformType: z.string().optional(),
        variables: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkTemplateLimit(ctx.db, ctx.creatorId);

      const [template] = await ctx.db
        .insert(responseTemplates)
        .values({
          creatorId: ctx.creatorId,
          name: input.name,
          content: input.content,
          category: input.category ?? null,
          platformType: input.platformType as any,
          variables: input.variables ?? [],
        })
        .returning();

      return template;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        content: z.string().min(1).optional(),
        category: z.string().max(100).optional(),
        platformType: z.string().optional(),
        variables: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.responseTemplates.findFirst({
        where: and(
          eq(responseTemplates.id, input.id),
          eq(responseTemplates.creatorId, ctx.creatorId)
        ),
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template no encontrado" });
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updateData.name = input.name;
      if (input.content !== undefined) updateData.content = input.content;
      if (input.category !== undefined) updateData.category = input.category;
      if (input.platformType !== undefined) updateData.platformType = input.platformType;
      if (input.variables !== undefined) updateData.variables = input.variables;

      const [updated] = await ctx.db
        .update(responseTemplates)
        .set(updateData)
        .where(eq(responseTemplates.id, input.id))
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.responseTemplates.findFirst({
        where: and(
          eq(responseTemplates.id, input.id),
          eq(responseTemplates.creatorId, ctx.creatorId)
        ),
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template no encontrado" });
      }

      await ctx.db
        .delete(responseTemplates)
        .where(eq(responseTemplates.id, input.id));

      return { success: true };
    }),

  incrementUsage: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const template = await ctx.db.query.responseTemplates.findFirst({
        where: and(
          eq(responseTemplates.id, input.id),
          eq(responseTemplates.creatorId, ctx.creatorId)
        ),
      });

      if (!template) return;

      await ctx.db
        .update(responseTemplates)
        .set({ usageCount: template.usageCount + 1 })
        .where(eq(responseTemplates.id, input.id));
    }),

  getCategories: protectedProcedure.query(async ({ ctx }) => {
    const all = await ctx.db.query.responseTemplates.findMany({
      where: eq(responseTemplates.creatorId, ctx.creatorId),
    });

    const categories = [...new Set(all.map((t) => t.category).filter(Boolean))] as string[];
    return categories;
  }),
});
