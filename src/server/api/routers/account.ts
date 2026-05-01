import { z } from "zod";
import { eq } from "drizzle-orm";
import { compare } from "bcryptjs";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { creators } from "@/server/db/schema";
import { getStripe } from "@/lib/stripe";

export const accountRouter = createTRPCRouter({
  /** Get current account info */
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const creator = await ctx.db.query.creators.findFirst({
      where: eq(creators.id, ctx.creatorId),
      columns: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        subscriptionPlan: true,
        createdAt: true,
      },
    });
    return creator;
  }),

  /** Get global instructions */
  getGlobalInstructions: protectedProcedure.query(async ({ ctx }) => {
    const creator = await ctx.db.query.creators.findFirst({
      where: eq(creators.id, ctx.creatorId),
      columns: { settings: true },
    });
    const settings = (creator?.settings ?? {}) as Record<string, unknown>;
    return { globalInstructions: (settings.globalInstructions as string) ?? "" };
  }),

  /** Save global instructions */
  saveGlobalInstructions: protectedProcedure
    .input(z.object({ globalInstructions: z.string().max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const creator = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, ctx.creatorId),
        columns: { settings: true },
      });
      const currentSettings = (creator?.settings ?? {}) as Record<string, unknown>;
      await ctx.db
        .update(creators)
        .set({
          settings: { ...currentSettings, globalInstructions: input.globalInstructions },
          updatedAt: new Date(),
        })
        .where(eq(creators.id, ctx.creatorId));
      return { success: true };
    }),

  /** Get email preferences */
  getEmailPreferences: protectedProcedure.query(async ({ ctx }) => {
    const creator = await ctx.db.query.creators.findFirst({
      where: eq(creators.id, ctx.creatorId),
      columns: {
        emailNotificationsEnabled: true,
        dailySummaryEnabled: true,
        weeklySummaryEnabled: true,
      },
    });
    return creator ?? { emailNotificationsEnabled: true, dailySummaryEnabled: false, weeklySummaryEnabled: true };
  }),

  /** Update email preferences */
  updateEmailPreferences: protectedProcedure
    .input(
      z.object({
        emailNotificationsEnabled: z.boolean(),
        dailySummaryEnabled: z.boolean(),
        weeklySummaryEnabled: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(creators)
        .set({
          emailNotificationsEnabled: input.emailNotificationsEnabled,
          dailySummaryEnabled: input.dailySummaryEnabled,
          weeklySummaryEnabled: input.weeklySummaryEnabled,
          updatedAt: new Date(),
        })
        .where(eq(creators.id, ctx.creatorId));
      return { success: true };
    }),

  /** Delete account and all associated data (cascading deletes handle the rest) */
  deleteAccount: protectedProcedure
    .input(
      z.object({
        password: z.string().min(1, "Debes confirmar tu contrasena"),
        confirmation: z
          .string()
          .refine((v) => v === "ELIMINAR", {
            message: 'Debes escribir "ELIMINAR" para confirmar',
          }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify password
      const creator = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, ctx.creatorId),
      });

      if (!creator) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta no encontrada" });
      }

      const isValid = await compare(input.password, creator.passwordHash);
      if (!isValid) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Contrasena incorrecta",
        });
      }

      // Cancel Stripe subscription if active
      if (creator.stripeSubscriptionId) {
        const stripe = getStripe();
        await stripe.subscriptions.cancel(creator.stripeSubscriptionId);
      }

      // Delete creator — cascading deletes handle all related data
      await ctx.db.delete(creators).where(eq(creators.id, ctx.creatorId));

      return { success: true };
    }),
});
