import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  managerProcedure,
} from "../trpc";
import {
  socialPosts,
  socialComments,
  notes,
  platforms,
  creators,
  aiUsageLog,
} from "@/server/db/schema";
import { platformTypeSchema } from "@/lib/constants";
import { resolveAIConfig } from "@/server/services/ai-config-resolver";
import { generateCommentSuggestion } from "@/server/services/ai-comment-suggester";
import { dispatchWebhookEvent } from "@/server/services/webhook-dispatcher";
import { checkAIMessageLimit } from "@/server/services/usage-limits";
import {
  linkOrCreateCommentAuthor,
  enqueueCommentAnalysis,
} from "@/server/services/social-comments-ingest";
import { publishEvent } from "@/lib/redis-pubsub";
import { logTeamAction } from "@/server/services/team-audit";

const COMMENT_PLATFORMS = ["instagram", "reddit", "twitter"] as const;

export const socialCommentsRouter = createTRPCRouter({
  // List posts (with comment counters)
  listPosts: protectedProcedure
    .input(
      z
        .object({
          platformType: platformTypeSchema.optional(),
          onlyWithUnhandled: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(socialPosts.creatorId, ctx.creatorId)];
      if (input?.platformType) {
        conditions.push(eq(socialPosts.platformType, input.platformType));
      }
      if (input?.onlyWithUnhandled) {
        conditions.push(sql`${socialPosts.unhandledCount} > 0`);
      }

      return ctx.db.query.socialPosts.findMany({
        where: and(...conditions),
        orderBy: [
          desc(socialPosts.unhandledCount),
          desc(socialPosts.lastCommentAt),
          desc(socialPosts.createdAt),
        ],
        limit: 100,
      });
    }),

  getPost: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const post = await ctx.db.query.socialPosts.findFirst({
        where: and(
          eq(socialPosts.id, input.id),
          eq(socialPosts.creatorId, ctx.creatorId)
        ),
      });
      if (!post) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post no encontrado" });
      }
      return post;
    }),

  listComments: protectedProcedure
    .input(
      z.object({
        postId: z.string().uuid(),
        onlyUnhandled: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify ownership of post
      const post = await ctx.db.query.socialPosts.findFirst({
        where: and(
          eq(socialPosts.id, input.postId),
          eq(socialPosts.creatorId, ctx.creatorId)
        ),
      });
      if (!post) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post no encontrado" });
      }

      const conditions = [eq(socialComments.postId, input.postId)];
      if (input.onlyUnhandled) {
        conditions.push(eq(socialComments.isHandled, false));
      }

      return ctx.db.query.socialComments.findMany({
        where: and(...conditions),
        with: {
          authorContact: { with: { profile: true } },
        },
        orderBy: (c, { asc }) => [asc(c.createdAt)],
      });
    }),

  // Manual post creation (testing / external integrations via UI)
  createPost: managerProcedure
    .input(
      z.object({
        platformType: z.enum(COMMENT_PLATFORMS),
        title: z.string().max(500).optional(),
        content: z.string().max(10_000).optional(),
        url: z.string().url().max(2000).optional(),
        externalPostId: z.string().max(255).optional(),
        publishedAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [post] = await ctx.db
        .insert(socialPosts)
        .values({
          creatorId: ctx.creatorId,
          platformType: input.platformType,
          title: input.title,
          content: input.content,
          url: input.url,
          externalPostId: input.externalPostId,
          publishedAt: input.publishedAt,
        })
        .returning();
      return post;
    }),

  deletePost: managerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(socialPosts)
        .where(
          and(
            eq(socialPosts.id, input.id),
            eq(socialPosts.creatorId, ctx.creatorId)
          )
        );
      return { ok: true };
    }),

  // Manual comment creation (used by tests, manual ingestion, REST endpoint shares core logic)
  createComment: protectedProcedure
    .input(
      z.object({
        postId: z.string().uuid(),
        parentCommentId: z.string().uuid().optional(),
        authorUsername: z.string().min(1).max(255),
        authorDisplayName: z.string().max(255).optional(),
        authorAvatarUrl: z.string().max(2000).optional(),
        authorPlatformUserId: z.string().max(255).optional(),
        content: z.string().min(1).max(10_000),
        externalCommentId: z.string().max(255).optional(),
        publishedAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const post = await ctx.db.query.socialPosts.findFirst({
        where: and(
          eq(socialPosts.id, input.postId),
          eq(socialPosts.creatorId, ctx.creatorId)
        ),
      });
      if (!post) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post no encontrado" });
      }

      // Resolve or create the contact for the comment author so they can
      // accumulate scoring/churn signals from public engagement.
      const { contactId: authorContactId } = await linkOrCreateCommentAuthor(
        ctx.db,
        ctx.creatorId,
        post.platformType as "instagram" | "reddit" | "twitter",
        {
          username: input.authorUsername,
          displayName: input.authorDisplayName,
          avatarUrl: input.authorAvatarUrl,
          platformUserId: input.authorPlatformUserId,
        }
      );

      const [comment] = await ctx.db
        .insert(socialComments)
        .values({
          creatorId: ctx.creatorId,
          postId: input.postId,
          parentCommentId: input.parentCommentId,
          platformType: post.platformType,
          externalCommentId: input.externalCommentId,
          authorContactId,
          authorUsername: input.authorUsername,
          authorDisplayName: input.authorDisplayName,
          authorAvatarUrl: input.authorAvatarUrl,
          content: input.content,
          publishedAt: input.publishedAt,
          role: "fan",
        })
        .returning();

      // Update post counters + lastCommentAt
      await ctx.db
        .update(socialPosts)
        .set({
          commentsCount: sql`${socialPosts.commentsCount} + 1`,
          unhandledCount: sql`${socialPosts.unhandledCount} + 1`,
          lastCommentAt: new Date(),
        })
        .where(eq(socialPosts.id, input.postId));

      // Dispatch webhook
      dispatchWebhookEvent(ctx.db, ctx.creatorId, "comment.received", {
        commentId: comment!.id,
        postId: input.postId,
        platformType: post.platformType,
        authorUsername: input.authorUsername,
        authorContactId,
        content: input.content,
      }).catch(() => {});

      // Enqueue scoring/sentiment analysis (writes sentiment back to socialComments)
      enqueueCommentAnalysis({
        creatorId: ctx.creatorId,
        contactId: authorContactId,
        commentId: comment!.id,
        content: input.content,
        platformType: post.platformType,
      });

      // Realtime push so the comments inbox refreshes without polling
      publishEvent(ctx.creatorId, {
        type: "new_comment",
        data: {
          commentId: comment!.id,
          postId: input.postId,
          platformType: post.platformType,
          authorUsername: input.authorUsername,
        },
      }).catch(() => {});

      return comment;
    }),

  markHandled: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        isHandled: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.socialComments.findFirst({
        where: and(
          eq(socialComments.id, input.id),
          eq(socialComments.creatorId, ctx.creatorId)
        ),
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Comentario no encontrado" });
      }

      const [updated] = await ctx.db
        .update(socialComments)
        .set({
          isHandled: input.isHandled,
          handledAt: input.isHandled ? new Date() : null,
          handledById: input.isHandled ? ctx.actingUserId : null,
        })
        .where(eq(socialComments.id, input.id))
        .returning();

      // Adjust post unhandledCount delta
      const delta =
        existing.isHandled === input.isHandled ? 0 : input.isHandled ? -1 : 1;
      if (delta !== 0) {
        await ctx.db
          .update(socialPosts)
          .set({
            unhandledCount: sql`GREATEST(0, ${socialPosts.unhandledCount} + ${delta})`,
          })
          .where(eq(socialPosts.id, existing.postId));
      }

      publishEvent(ctx.creatorId, {
        type: "comment_handled",
        data: {
          commentId: input.id,
          postId: existing.postId,
          isHandled: input.isHandled,
        },
      }).catch(() => {});

      if (ctx.teamRole) {
        logTeamAction(ctx.db, {
          creatorId: ctx.creatorId,
          userId: ctx.actingUserId,
          userName: ctx.session!.user.name ?? "Unknown",
          action: input.isHandled
            ? "comment.marked_handled"
            : "comment.marked_pending",
          entityType: "social_comment",
          entityId: input.id,
          details: { postId: existing.postId },
        });
      }

      return updated;
    }),

  // Reply to a comment publicly (records the creator's response as a child comment)
  replyToComment: protectedProcedure
    .input(
      z.object({
        commentId: z.string().uuid(),
        content: z.string().min(1).max(10_000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const parent = await ctx.db.query.socialComments.findFirst({
        where: and(
          eq(socialComments.id, input.commentId),
          eq(socialComments.creatorId, ctx.creatorId)
        ),
      });
      if (!parent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Comentario no encontrado" });
      }

      const [reply] = await ctx.db
        .insert(socialComments)
        .values({
          creatorId: ctx.creatorId,
          postId: parent.postId,
          parentCommentId: parent.id,
          platformType: parent.platformType,
          authorUsername: "creator",
          content: input.content,
          role: "creator",
          source: "manual",
        })
        .returning();

      const updates: Partial<typeof socialComments.$inferInsert> = {
        creatorReplyId: reply!.id,
      };
      let delta = 0;
      if (!parent.isHandled) {
        updates.isHandled = true;
        updates.handledAt = new Date();
        updates.handledById = ctx.actingUserId;
        delta = -1;
      }

      await ctx.db
        .update(socialComments)
        .set(updates)
        .where(eq(socialComments.id, parent.id));

      await ctx.db
        .update(socialPosts)
        .set({
          commentsCount: sql`${socialPosts.commentsCount} + 1`,
          unhandledCount: sql`GREATEST(0, ${socialPosts.unhandledCount} + ${delta})`,
          lastCommentAt: new Date(),
        })
        .where(eq(socialPosts.id, parent.postId));

      publishEvent(ctx.creatorId, {
        type: "new_comment",
        data: {
          commentId: reply!.id,
          postId: parent.postId,
          parentCommentId: parent.id,
          role: "creator",
        },
      }).catch(() => {});

      if (ctx.teamRole) {
        logTeamAction(ctx.db, {
          creatorId: ctx.creatorId,
          userId: ctx.actingUserId,
          userName: ctx.session!.user.name ?? "Unknown",
          action: "comment.replied",
          entityType: "social_comment",
          entityId: parent.id,
          details: {
            postId: parent.postId,
            replyId: reply?.id,
            platform: parent.platformType,
          },
        });
      }

      return reply;
    }),

  // AI suggestion for replying to a comment
  suggest: protectedProcedure
    .input(z.object({ commentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await checkAIMessageLimit(ctx.db, ctx.creatorId);

      const config = await resolveAIConfig(ctx.db, ctx.creatorId, "suggestion");
      if (!config) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No has configurado tu proveedor de IA. Ve a Configuración > Modelo IA.",
        });
      }

      const comment = await ctx.db.query.socialComments.findFirst({
        where: and(
          eq(socialComments.id, input.commentId),
          eq(socialComments.creatorId, ctx.creatorId)
        ),
        with: {
          post: true,
          authorContact: { with: { profile: true } },
        },
      });
      if (!comment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Comentario no encontrado" });
      }

      const [platform, creator] = await Promise.all([
        ctx.db.query.platforms.findFirst({
          where: and(
            eq(platforms.creatorId, ctx.creatorId),
            eq(platforms.platformType, comment.platformType)
          ),
        }),
        ctx.db.query.creators.findFirst({
          where: eq(creators.id, ctx.creatorId),
          columns: { settings: true },
        }),
      ]);

      const settings = (creator?.settings ?? {}) as Record<string, unknown>;
      const globalInstructions =
        (settings.globalInstructions as string) || undefined;
      const responseLanguage =
        (settings.responseLanguage as string) || undefined;

      // Load thread context (siblings + parent chain, ordered)
      const threadComments = await ctx.db.query.socialComments.findMany({
        where: eq(socialComments.postId, comment.postId),
        orderBy: (c, { asc }) => [asc(c.createdAt)],
        limit: 30,
      });

      const thread = threadComments
        .filter((c) => c.id !== comment.id)
        .map((c) => ({
          role: c.role as "fan" | "creator",
          authorUsername: c.authorUsername,
          content: c.content,
        }));

      const contactNotes = comment.authorContactId
        ? await ctx.db.query.notes.findMany({
            where: and(
              eq(notes.creatorId, ctx.creatorId),
              eq(notes.contactId, comment.authorContactId)
            ),
          })
        : [];

      const profile = comment.authorContact?.profile ?? null;

      const result = await generateCommentSuggestion(config, {
        platformType: comment.platformType,
        personality:
          (platform?.personalityConfig as Record<string, unknown>) ?? {},
        globalInstructions,
        language: responseLanguage,
        post: {
          title: comment.post.title,
          content: comment.post.content,
          url: comment.post.url,
        },
        thread,
        fanComment: {
          authorUsername: comment.authorUsername,
          content: comment.content,
        },
        authorProfile: profile
          ? {
              engagementLevel: profile.engagementLevel,
              funnelStage: profile.funnelStage,
              paymentProbability: profile.paymentProbability,
            }
          : null,
        contactNotes: contactNotes.map((n) => n.content),
      });

      // Persist last suggestion on the comment
      await ctx.db
        .update(socialComments)
        .set({ aiSuggestion: result.variants.map((v) => v.content).join("\n---\n") })
        .where(eq(socialComments.id, input.commentId));

      await ctx.db.insert(aiUsageLog).values({
        creatorId: ctx.creatorId,
        requestType: "suggestion" as const,
        tokensUsed: result.tokensUsed,
        modelUsed: `${result.provider}/${result.model}`,
      });

      return {
        suggestions: result.suggestions,
        variants: result.variants,
        tokensUsed: result.tokensUsed,
      };
    }),

  // Stats overview for the page header
  overview: protectedProcedure.query(async ({ ctx }) => {
    const [postsCount] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(socialPosts)
      .where(eq(socialPosts.creatorId, ctx.creatorId));

    const [unhandledRow] = await ctx.db
      .select({
        total: sql<number>`COALESCE(SUM(${socialPosts.unhandledCount}), 0)::int`,
      })
      .from(socialPosts)
      .where(eq(socialPosts.creatorId, ctx.creatorId));

    const [commentsRow] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(socialComments)
      .where(eq(socialComments.creatorId, ctx.creatorId));

    return {
      postsCount: postsCount?.count ?? 0,
      unhandledCount: unhandledRow?.total ?? 0,
      commentsCount: commentsRow?.count ?? 0,
    };
  }),
});
