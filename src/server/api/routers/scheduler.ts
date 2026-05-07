import { z } from "zod";
import { eq, and, desc, gte, lte, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  managerProcedure,
  ownerProcedure,
} from "../trpc";
import { socialAccounts, scheduledPosts } from "@/server/db/schema";
import { encrypt } from "@/lib/crypto";
import { scheduledPostQueue } from "@/server/queues";
import {
  verifyRedditCredentials,
  type RedditCredentials,
} from "@/server/services/scheduler-publisher";
import { dispatchWebhookEvent } from "@/server/services/webhook-dispatcher";

const SCHEDULER_PLATFORMS = ["reddit", "twitter", "instagram"] as const;
const PLATFORM_ENUM = z.enum(SCHEDULER_PLATFORMS);

export const schedulerRouter = createTRPCRouter({
  // ---- Social Accounts ----
  listAccounts: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.socialAccounts.findMany({
      where: eq(socialAccounts.creatorId, ctx.creatorId),
    });
    // Strip encryptedCredentials from response
    return rows.map((r) => ({
      id: r.id,
      platformType: r.platformType,
      connectionType: r.connectionType,
      accountUsername: r.accountUsername,
      isActive: r.isActive,
      lastVerifiedAt: r.lastVerifiedAt,
      lastErrorMessage: r.lastErrorMessage,
      hasCredentials: !!r.encryptedCredentials,
      createdAt: r.createdAt,
    }));
  }),

  connectReddit: ownerProcedure
    .input(
      z.object({
        clientId: z.string().min(1).max(255),
        clientSecret: z.string().min(1).max(500),
        username: z.string().min(1).max(255),
        password: z.string().min(1).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const creds: RedditCredentials = {
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        username: input.username,
        password: input.password,
      };

      const verify = await verifyRedditCredentials(creds);
      if (!verify.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No se pudo conectar con Reddit: ${verify.error}`,
        });
      }

      const encrypted = encrypt(JSON.stringify(creds));

      const existing = await ctx.db.query.socialAccounts.findFirst({
        where: and(
          eq(socialAccounts.creatorId, ctx.creatorId),
          eq(socialAccounts.platformType, "reddit")
        ),
      });

      if (existing) {
        const [updated] = await ctx.db
          .update(socialAccounts)
          .set({
            connectionType: "native",
            encryptedCredentials: encrypted,
            accountUsername: verify.username,
            isActive: true,
            lastVerifiedAt: new Date(),
            lastErrorMessage: null,
            updatedAt: new Date(),
          })
          .where(eq(socialAccounts.id, existing.id))
          .returning();
        return updated;
      }

      const [created] = await ctx.db
        .insert(socialAccounts)
        .values({
          creatorId: ctx.creatorId,
          platformType: "reddit",
          connectionType: "native",
          encryptedCredentials: encrypted,
          accountUsername: verify.username,
          isActive: true,
          lastVerifiedAt: new Date(),
        })
        .returning();
      return created;
    }),

  enableWebhookConnection: ownerProcedure
    .input(z.object({ platformType: PLATFORM_ENUM }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.socialAccounts.findFirst({
        where: and(
          eq(socialAccounts.creatorId, ctx.creatorId),
          eq(socialAccounts.platformType, input.platformType)
        ),
      });

      if (existing) {
        const [updated] = await ctx.db
          .update(socialAccounts)
          .set({
            connectionType: "webhook",
            encryptedCredentials: null,
            accountUsername: null,
            isActive: true,
            lastVerifiedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(socialAccounts.id, existing.id))
          .returning();
        return updated;
      }

      const [created] = await ctx.db
        .insert(socialAccounts)
        .values({
          creatorId: ctx.creatorId,
          platformType: input.platformType,
          connectionType: "webhook",
          isActive: true,
          lastVerifiedAt: new Date(),
        })
        .returning();
      return created;
    }),

  disconnectAccount: ownerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(socialAccounts)
        .where(
          and(
            eq(socialAccounts.id, input.id),
            eq(socialAccounts.creatorId, ctx.creatorId)
          )
        );
      return { ok: true };
    }),

  // ---- Scheduled Posts ----
  list: protectedProcedure
    .input(
      z
        .object({
          status: z
            .enum([
              "scheduled",
              "processing",
              "posted",
              "partial",
              "failed",
              "cancelled",
            ])
            .optional(),
          from: z.date().optional(),
          to: z.date().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(scheduledPosts.creatorId, ctx.creatorId)];
      if (input?.status) conditions.push(eq(scheduledPosts.status, input.status));
      if (input?.from) conditions.push(gte(scheduledPosts.scheduleAt, input.from));
      if (input?.to) conditions.push(lte(scheduledPosts.scheduleAt, input.to));

      return ctx.db.query.scheduledPosts.findMany({
        where: and(...conditions),
        orderBy: [desc(scheduledPosts.scheduleAt)],
        limit: 200,
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const post = await ctx.db.query.scheduledPosts.findFirst({
        where: and(
          eq(scheduledPosts.id, input.id),
          eq(scheduledPosts.creatorId, ctx.creatorId)
        ),
      });
      if (!post) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post no encontrado" });
      }
      return post;
    }),

  calendar: protectedProcedure
    .input(z.object({ year: z.number().int(), month: z.number().int().min(0).max(11) }))
    .query(async ({ ctx, input }) => {
      const start = new Date(input.year, input.month, 1);
      const end = new Date(input.year, input.month + 1, 1);
      const rows = await ctx.db.query.scheduledPosts.findMany({
        where: and(
          eq(scheduledPosts.creatorId, ctx.creatorId),
          gte(scheduledPosts.scheduleAt, start),
          lte(scheduledPosts.scheduleAt, end)
        ),
        orderBy: [scheduledPosts.scheduleAt],
      });
      return rows;
    }),

  create: managerProcedure
    .input(
      z.object({
        title: z.string().max(500).optional(),
        content: z.string().min(1).max(40_000),
        targetPlatforms: z.array(PLATFORM_ENUM).min(1).max(10),
        scheduleAt: z.date(),
        timezone: z.string().max(60).default("UTC"),
        mediaUrls: z.array(z.string().url().max(2000)).default([]),
        platformConfigs: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.scheduleAt.getTime() < Date.now() - 30_000) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La fecha programada está en el pasado.",
        });
      }

      // Verify each target platform has an active account
      const accounts = await ctx.db.query.socialAccounts.findMany({
        where: and(
          eq(socialAccounts.creatorId, ctx.creatorId),
          eq(socialAccounts.isActive, true),
          inArray(socialAccounts.platformType, input.targetPlatforms)
        ),
      });
      const connectedPlatforms = new Set(accounts.map((a) => a.platformType));
      const missing = input.targetPlatforms.filter(
        (p) => !connectedPlatforms.has(p)
      );
      if (missing.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Conecta primero estas cuentas: ${missing.join(", ")}`,
        });
      }

      const [post] = await ctx.db
        .insert(scheduledPosts)
        .values({
          creatorId: ctx.creatorId,
          title: input.title,
          content: input.content,
          targetPlatforms: input.targetPlatforms,
          mediaUrls: input.mediaUrls,
          platformConfigs: input.platformConfigs,
          scheduleAt: input.scheduleAt,
          timezone: input.timezone,
          createdById: ctx.actingUserId,
        })
        .returning();

      const delay = Math.max(0, input.scheduleAt.getTime() - Date.now());
      const job = await scheduledPostQueue.add(
        "publish",
        { scheduledPostId: post!.id, creatorId: ctx.creatorId },
        { delay }
      );

      await ctx.db
        .update(scheduledPosts)
        .set({ jobId: job.id ?? null })
        .where(eq(scheduledPosts.id, post!.id));

      dispatchWebhookEvent(ctx.db, ctx.creatorId, "post.scheduled", {
        scheduledPostId: post!.id,
        targetPlatforms: input.targetPlatforms,
        scheduleAt: input.scheduleAt.toISOString(),
      }).catch(() => {});

      return post;
    }),

  cancel: managerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const post = await ctx.db.query.scheduledPosts.findFirst({
        where: and(
          eq(scheduledPosts.id, input.id),
          eq(scheduledPosts.creatorId, ctx.creatorId)
        ),
      });
      if (!post) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post no encontrado" });
      }
      if (post.status !== "scheduled" && post.status !== "failed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Solo se pueden cancelar posts en estado scheduled o failed.",
        });
      }

      if (post.jobId) {
        try {
          const job = await scheduledPostQueue.getJob(post.jobId);
          if (job) await job.remove();
        } catch {
          // Best-effort: BullMQ job may already have run
        }
      }

      const [updated] = await ctx.db
        .update(scheduledPosts)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(scheduledPosts.id, input.id))
        .returning();
      return updated;
    }),

  reschedule: managerProcedure
    .input(z.object({ id: z.string().uuid(), scheduleAt: z.date() }))
    .mutation(async ({ ctx, input }) => {
      if (input.scheduleAt.getTime() < Date.now() - 30_000) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La fecha programada está en el pasado.",
        });
      }

      const post = await ctx.db.query.scheduledPosts.findFirst({
        where: and(
          eq(scheduledPosts.id, input.id),
          eq(scheduledPosts.creatorId, ctx.creatorId)
        ),
      });
      if (!post) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post no encontrado" });
      }
      if (post.status !== "scheduled" && post.status !== "failed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Solo se pueden reprogramar posts pendientes.",
        });
      }

      if (post.jobId) {
        try {
          const job = await scheduledPostQueue.getJob(post.jobId);
          if (job) await job.remove();
        } catch {
          // ignore
        }
      }

      const delay = Math.max(0, input.scheduleAt.getTime() - Date.now());
      const job = await scheduledPostQueue.add(
        "publish",
        { scheduledPostId: post.id, creatorId: ctx.creatorId },
        { delay }
      );

      const [updated] = await ctx.db
        .update(scheduledPosts)
        .set({
          scheduleAt: input.scheduleAt,
          status: "scheduled",
          jobId: job.id ?? null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(scheduledPosts.id, input.id))
        .returning();

      return updated;
    }),
});
