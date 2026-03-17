import { z } from "zod";
import { eq, and, desc, count, sum, sql, ilike, inArray } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  mediaItems,
  mediaCategories,
  mediaSends,
  contacts,
} from "@/server/db/schema";
import { checkMediaFileLimit } from "@/server/services/usage-limits";
import { unlink } from "fs/promises";
import { join } from "path";

const UPLOADS_DIR = join(process.cwd(), "uploads");

export const mediaRouter = createTRPCRouter({
  // Listar media con filtros
  list: protectedProcedure
    .input(
      z.object({
        mediaType: z.enum(["image", "video", "gif"]).optional(),
        categoryId: z.string().uuid().optional(),
        search: z.string().optional(),
        tag: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(mediaItems.creatorId, ctx.creatorId),
        eq(mediaItems.isArchived, false),
      ];

      if (input.mediaType) {
        conditions.push(eq(mediaItems.mediaType, input.mediaType));
      }
      if (input.categoryId) {
        conditions.push(eq(mediaItems.categoryId, input.categoryId));
      }
      if (input.search) {
        conditions.push(
          ilike(mediaItems.originalName, `%${input.search}%`)
        );
      }
      if (input.tag) {
        conditions.push(sql`${input.tag} = ANY(${mediaItems.tags})`);
      }

      const [totalResult] = await ctx.db
        .select({ count: count() })
        .from(mediaItems)
        .where(and(...conditions));

      const items = await ctx.db
        .select()
        .from(mediaItems)
        .where(and(...conditions))
        .orderBy(desc(mediaItems.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return {
        items,
        total: totalResult?.count ?? 0,
      };
    }),

  // Detalle
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const item = await ctx.db.query.mediaItems.findFirst({
        where: and(
          eq(mediaItems.id, input.id),
          eq(mediaItems.creatorId, ctx.creatorId)
        ),
        with: {
          category: true,
          sends: {
            with: { contact: { columns: { id: true, username: true, displayName: true } } },
            orderBy: [desc(mediaSends.sentAt)],
          },
        },
      });

      return item ?? null;
    }),

  // Actualizar metadata
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        tags: z.array(z.string()).optional(),
        categoryId: z.string().uuid().nullable().optional(),
        originalName: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.tags !== undefined) updates.tags = input.tags;
      if (input.categoryId !== undefined) updates.categoryId = input.categoryId;
      if (input.originalName) updates.originalName = input.originalName;

      const [updated] = await ctx.db
        .update(mediaItems)
        .set(updates)
        .where(
          and(
            eq(mediaItems.id, input.id),
            eq(mediaItems.creatorId, ctx.creatorId)
          )
        )
        .returning();

      return updated;
    }),

  // Eliminar
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.query.mediaItems.findFirst({
        where: and(
          eq(mediaItems.id, input.id),
          eq(mediaItems.creatorId, ctx.creatorId)
        ),
      });

      if (!item) return { success: false };

      // Borrar de DB primero
      await ctx.db
        .delete(mediaItems)
        .where(eq(mediaItems.id, input.id));

      // Borrar archivos del filesystem
      try {
        await unlink(join(UPLOADS_DIR, item.storagePath));
        if (item.thumbnailPath) {
          await unlink(join(UPLOADS_DIR, item.thumbnailPath));
        }
      } catch {
        // Si falla borrar archivo, no es crítico (queda huérfano)
      }

      return { success: true };
    }),

  // Stats
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const [fileStats] = await ctx.db
      .select({
        count: count(),
        totalSize: sum(mediaItems.fileSize),
      })
      .from(mediaItems)
      .where(
        and(
          eq(mediaItems.creatorId, ctx.creatorId),
          eq(mediaItems.isArchived, false)
        )
      );

    // Más enviado
    const [mostSent] = await ctx.db
      .select({
        id: mediaItems.id,
        originalName: mediaItems.originalName,
        sendCount: mediaItems.sendCount,
      })
      .from(mediaItems)
      .where(eq(mediaItems.creatorId, ctx.creatorId))
      .orderBy(desc(mediaItems.sendCount))
      .limit(1);

    return {
      totalFiles: fileStats?.count ?? 0,
      totalSizeMB: Math.round(Number(fileStats?.totalSize ?? 0) / 1024 / 1024 * 10) / 10,
      mostSent: mostSent?.sendCount ? mostSent : null,
    };
  }),

  // Marcar como enviado a contacto
  markAsSent: protectedProcedure
    .input(
      z.object({
        mediaItemId: z.string().uuid(),
        contactId: z.string().uuid(),
        conversationId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verificar propiedad
      const item = await ctx.db.query.mediaItems.findFirst({
        where: and(
          eq(mediaItems.id, input.mediaItemId),
          eq(mediaItems.creatorId, ctx.creatorId)
        ),
      });
      if (!item) return { success: false, alreadySent: false };

      // Verificar contacto
      const contact = await ctx.db.query.contacts.findFirst({
        where: and(
          eq(contacts.id, input.contactId),
          eq(contacts.creatorId, ctx.creatorId)
        ),
      });
      if (!contact) return { success: false, alreadySent: false };

      // Intentar insertar (unique constraint previene duplicados)
      try {
        await ctx.db.insert(mediaSends).values({
          mediaItemId: input.mediaItemId,
          contactId: input.contactId,
          conversationId: input.conversationId,
        });

        // Incrementar sendCount
        await ctx.db
          .update(mediaItems)
          .set({ sendCount: sql`${mediaItems.sendCount} + 1` })
          .where(eq(mediaItems.id, input.mediaItemId));

        return { success: true, alreadySent: false };
      } catch {
        return { success: false, alreadySent: true };
      }
    }),

  // Verificar si ya se envió a un contacto
  checkSentToContact: protectedProcedure
    .input(
      z.object({
        mediaItemIds: z.array(z.string().uuid()),
        contactId: z.string().uuid(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (input.mediaItemIds.length === 0) return {};

      const sends = await ctx.db
        .select({ mediaItemId: mediaSends.mediaItemId })
        .from(mediaSends)
        .where(
          and(
            inArray(mediaSends.mediaItemId, input.mediaItemIds),
            eq(mediaSends.contactId, input.contactId)
          )
        );

      const sentSet = new Set(sends.map((s) => s.mediaItemId));
      const result: Record<string, boolean> = {};
      for (const id of input.mediaItemIds) {
        result[id] = sentSet.has(id);
      }
      return result;
    }),

  // --- Categorías ---

  listCategories: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(mediaCategories)
      .where(eq(mediaCategories.creatorId, ctx.creatorId))
      .orderBy(mediaCategories.sortOrder);
  }),

  createCategory: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6366f1"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [cat] = await ctx.db
        .insert(mediaCategories)
        .values({
          creatorId: ctx.creatorId,
          name: input.name,
          color: input.color,
        })
        .returning();
      return cat;
    }),

  updateCategory: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updates: Record<string, unknown> = {};
      if (input.name) updates.name = input.name;
      if (input.color) updates.color = input.color;

      const [updated] = await ctx.db
        .update(mediaCategories)
        .set(updates)
        .where(
          and(
            eq(mediaCategories.id, input.id),
            eq(mediaCategories.creatorId, ctx.creatorId)
          )
        )
        .returning();
      return updated;
    }),

  deleteCategory: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(mediaCategories)
        .where(
          and(
            eq(mediaCategories.id, input.id),
            eq(mediaCategories.creatorId, ctx.creatorId)
          )
        );
      return { success: true };
    }),
});
