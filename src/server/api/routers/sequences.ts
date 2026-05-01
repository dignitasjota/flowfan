import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { sequences, sequenceEnrollments, contacts } from "@/server/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  enrollContact,
  cancelEnrollment,
  getSequenceStats,
} from "@/server/services/sequence-engine";

const stepSchema = z.object({
  stepNumber: z.number(),
  delayDays: z.number().min(0),
  actionType: z.enum(["send_message", "create_notification"]),
  actionConfig: z.record(z.unknown()),
  conditions: z.record(z.unknown()).optional(),
});

export const sequencesRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const result = await ctx.db
      .select()
      .from(sequences)
      .where(eq(sequences.creatorId, ctx.creatorId))
      .orderBy(desc(sequences.createdAt));

    return result;
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [sequence] = await ctx.db
        .select()
        .from(sequences)
        .where(and(eq(sequences.id, input.id), eq(sequences.creatorId, ctx.creatorId)))
        .limit(1);

      if (!sequence) return null;

      const stats = await getSequenceStats(ctx.db, input.id);

      const enrollments = await ctx.db
        .select({
          id: sequenceEnrollments.id,
          contactId: sequenceEnrollments.contactId,
          currentStep: sequenceEnrollments.currentStep,
          status: sequenceEnrollments.status,
          enrolledAt: sequenceEnrollments.enrolledAt,
          lastStepAt: sequenceEnrollments.lastStepAt,
          nextStepAt: sequenceEnrollments.nextStepAt,
          contactUsername: contacts.username,
          contactDisplayName: contacts.displayName,
        })
        .from(sequenceEnrollments)
        .innerJoin(contacts, eq(sequenceEnrollments.contactId, contacts.id))
        .where(eq(sequenceEnrollments.sequenceId, input.id))
        .orderBy(desc(sequenceEnrollments.enrolledAt))
        .limit(50);

      return { ...sequence, stats, enrollments };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        type: z.enum(["nurturing", "followup", "custom"]),
        steps: z.array(stepSchema).min(1),
        enrollmentCriteria: z.record(z.unknown()).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(sequences)
        .values({
          creatorId: ctx.creatorId,
          name: input.name,
          description: input.description ?? null,
          type: input.type,
          steps: input.steps,
          enrollmentCriteria: input.enrollmentCriteria ?? {},
          isActive: input.isActive ?? false,
        })
        .returning();

      return created;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        steps: z.array(stepSchema).min(1).optional(),
        enrollmentCriteria: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.steps !== undefined) updateData.steps = input.steps;
      if (input.enrollmentCriteria !== undefined) updateData.enrollmentCriteria = input.enrollmentCriteria;

      await ctx.db
        .update(sequences)
        .set(updateData)
        .where(and(eq(sequences.id, input.id), eq(sequences.creatorId, ctx.creatorId)));

      return { success: true };
    }),

  toggleActive: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [current] = await ctx.db
        .select({ isActive: sequences.isActive })
        .from(sequences)
        .where(and(eq(sequences.id, input.id), eq(sequences.creatorId, ctx.creatorId)))
        .limit(1);

      if (!current) return { success: false };

      await ctx.db
        .update(sequences)
        .set({ isActive: !current.isActive, updatedAt: new Date() })
        .where(eq(sequences.id, input.id));

      return { success: true, isActive: !current.isActive };
    }),

  getStats: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return getSequenceStats(ctx.db, input.id);
    }),

  getEnrollments: protectedProcedure
    .input(
      z.object({
        sequenceId: z.string().uuid(),
        status: z.enum(["active", "completed", "cancelled", "paused"]).optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(sequenceEnrollments.sequenceId, input.sequenceId)];
      if (input.status) {
        conditions.push(eq(sequenceEnrollments.status, input.status));
      }

      const enrollments = await ctx.db
        .select({
          id: sequenceEnrollments.id,
          contactId: sequenceEnrollments.contactId,
          currentStep: sequenceEnrollments.currentStep,
          status: sequenceEnrollments.status,
          enrolledAt: sequenceEnrollments.enrolledAt,
          lastStepAt: sequenceEnrollments.lastStepAt,
          nextStepAt: sequenceEnrollments.nextStepAt,
          contactUsername: contacts.username,
          contactDisplayName: contacts.displayName,
        })
        .from(sequenceEnrollments)
        .innerJoin(contacts, eq(sequenceEnrollments.contactId, contacts.id))
        .where(and(...conditions))
        .orderBy(desc(sequenceEnrollments.enrolledAt))
        .limit(input.limit)
        .offset(input.offset);

      const [{ count }] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(sequenceEnrollments)
        .where(and(...conditions));

      return { enrollments, total: count };
    }),

  cancelEnrollment: protectedProcedure
    .input(z.object({ enrollmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const [enrollment] = await ctx.db
        .select({ creatorId: sequenceEnrollments.creatorId })
        .from(sequenceEnrollments)
        .where(eq(sequenceEnrollments.id, input.enrollmentId))
        .limit(1);

      if (!enrollment || enrollment.creatorId !== ctx.creatorId) {
        return { success: false };
      }

      await cancelEnrollment(ctx.db, input.enrollmentId);
      return { success: true };
    }),

  enrollContact: protectedProcedure
    .input(
      z.object({
        sequenceId: z.string().uuid(),
        contactId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return enrollContact(ctx.db, input.sequenceId, input.contactId, ctx.creatorId);
    }),
});
