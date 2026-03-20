import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, ownerProcedure } from "../trpc";
import { creators } from "@/server/db/schema";
import { getStripe, PLAN_PRICE_IDS } from "@/lib/stripe";
import { PLAN_LIMITS, getUsageSummary } from "@/server/services/usage-limits";

export const billingRouter = createTRPCRouter({
  getPlan: protectedProcedure.query(async ({ ctx }) => {
    const creator = await ctx.db.query.creators.findFirst({
      where: eq(creators.id, ctx.creatorId),
      columns: {
        subscriptionPlan: true,
        subscriptionStatus: true,
        currentPeriodEnd: true,
        stripeSubscriptionId: true,
        onboardingCompleted: true,
      },
    });

    if (!creator) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }

    const plan = (creator.subscriptionPlan ?? "free") as keyof typeof PLAN_LIMITS;

    return {
      plan,
      status: creator.subscriptionStatus,
      currentPeriodEnd: creator.currentPeriodEnd,
      hasSubscription: !!creator.stripeSubscriptionId,
      onboardingCompleted: creator.onboardingCompleted,
      limits: PLAN_LIMITS[plan],
    };
  }),

  getUsage: protectedProcedure.query(async ({ ctx }) => {
    return getUsageSummary(ctx.db, ctx.creatorId);
  }),

  createCheckoutSession: ownerProcedure
    .input(z.object({ plan: z.enum(["starter", "pro"]) }))
    .mutation(async ({ ctx, input }) => {
      const creator = await ctx.db.query.creators.findFirst({
        where: eq(creators.id, ctx.creatorId),
        columns: {
          id: true,
          email: true,
          stripeCustomerId: true,
        },
      });

      if (!creator) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      let customerId = creator.stripeCustomerId;

      if (!customerId) {
        const customer = await getStripe().customers.create({
          email: creator.email,
          metadata: { creatorId: creator.id },
        });
        customerId = customer.id;

        await ctx.db
          .update(creators)
          .set({ stripeCustomerId: customerId, updatedAt: new Date() })
          .where(eq(creators.id, ctx.creatorId));
      }

      const priceId = PLAN_PRICE_IDS[input.plan];

      const session = await getStripe().checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${process.env.NEXTAUTH_URL}/billing?success=true`,
        cancel_url: `${process.env.NEXTAUTH_URL}/billing?canceled=true`,
        metadata: { creatorId: creator.id },
      });

      return { url: session.url };
    }),

  createPortalSession: ownerProcedure.mutation(async ({ ctx }) => {
    const creator = await ctx.db.query.creators.findFirst({
      where: eq(creators.id, ctx.creatorId),
      columns: { stripeCustomerId: true },
    });

    if (!creator?.stripeCustomerId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No tienes una suscripción activa.",
      });
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: creator.stripeCustomerId,
      return_url: `${process.env.NEXTAUTH_URL}/billing`,
    });

    return { url: session.url };
  }),

  getInvoices: protectedProcedure.query(async ({ ctx }) => {
    const creator = await ctx.db.query.creators.findFirst({
      where: eq(creators.id, ctx.creatorId),
      columns: { stripeCustomerId: true },
    });

    if (!creator?.stripeCustomerId) {
      return [];
    }

    const invoices = await getStripe().invoices.list({
      customer: creator.stripeCustomerId,
      limit: 10,
    });

    return invoices.data.map((inv) => ({
      id: inv.id,
      date: inv.created ? new Date(inv.created * 1000) : null,
      amount: inv.amount_paid ? inv.amount_paid / 100 : 0,
      currency: inv.currency,
      status: inv.status,
      pdfUrl: inv.invoice_pdf,
    }));
  }),

  completeOnboarding: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(creators)
      .set({ onboardingCompleted: true, updatedAt: new Date() })
      .where(eq(creators.id, ctx.creatorId));
    return { success: true };
  }),
});
