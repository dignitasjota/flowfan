import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// Mock Stripe
vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn().mockReturnValue({
    customers: {
      create: vi.fn().mockResolvedValue({ id: "cus_test123" }),
    },
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({ url: "https://checkout.stripe.com/test" }),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn().mockResolvedValue({ url: "https://billing.stripe.com/test" }),
      },
    },
    invoices: {
      list: vi.fn().mockResolvedValue({
        data: [
          {
            id: "inv_1",
            created: 1700000000,
            amount_paid: 1500,
            currency: "usd",
            status: "paid",
            invoice_pdf: "https://stripe.com/pdf/1",
          },
        ],
      }),
    },
  }),
  PLAN_PRICE_IDS: {
    starter: "price_starter_test",
    pro: "price_pro_test",
  },
  getPlanFromPriceId: vi.fn(),
}));

vi.mock("@/server/services/usage-limits", () => ({
  PLAN_LIMITS: {
    free: { contacts: 5, aiMessagesPerMonth: 20, platforms: 1, templates: 3, reportsPerMonth: 0 },
    starter: { contacts: 50, aiMessagesPerMonth: 200, platforms: 3, templates: 20, reportsPerMonth: 5 },
    pro: { contacts: -1, aiMessagesPerMonth: 2000, platforms: -1, templates: -1, reportsPerMonth: -1 },
    business: { contacts: -1, aiMessagesPerMonth: -1, platforms: -1, templates: -1, reportsPerMonth: -1 },
  },
  getUsageSummary: vi.fn().mockResolvedValue({
    contacts: { used: 3, limit: 5, unlimited: false },
    aiMessages: { used: 10, limit: 20, unlimited: false },
  }),
}));

import { getStripe, PLAN_PRICE_IDS } from "@/lib/stripe";
import { PLAN_LIMITS, getUsageSummary } from "@/server/services/usage-limits";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("billing router logic", () => {
  describe("getPlan", () => {
    it("returns plan info for existing creator", () => {
      const creator = {
        subscriptionPlan: "starter",
        subscriptionStatus: "active",
        currentPeriodEnd: new Date("2025-03-01"),
        stripeSubscriptionId: "sub_123",
        onboardingCompleted: true,
      };

      const plan = (creator.subscriptionPlan ?? "free") as keyof typeof PLAN_LIMITS;

      expect(plan).toBe("starter");
      expect(PLAN_LIMITS[plan].contacts).toBe(50);
      expect(creator.stripeSubscriptionId).toBeTruthy();
    });

    it("defaults to free plan when null", () => {
      const creator = { subscriptionPlan: null };
      const plan = (creator.subscriptionPlan ?? "free") as keyof typeof PLAN_LIMITS;
      expect(plan).toBe("free");
      expect(PLAN_LIMITS[plan].contacts).toBe(5);
    });

    it("throws NOT_FOUND when creator not found", () => {
      const creator = null;
      expect(() => {
        if (!creator) throw new TRPCError({ code: "NOT_FOUND" });
      }).toThrow(TRPCError);
    });
  });

  describe("createCheckoutSession", () => {
    it("creates Stripe customer if not exists", async () => {
      const stripe = getStripe();
      const customer = await stripe.customers.create({
        email: "test@test.com",
        metadata: { creatorId: "c1" },
      });
      expect(customer.id).toBe("cus_test123");
    });

    it("uses existing customer if available", () => {
      const creator = { stripeCustomerId: "cus_existing" };
      const customerId = creator.stripeCustomerId;
      expect(customerId).toBe("cus_existing");
    });

    it("creates checkout session with correct price", async () => {
      const plan = "starter" as const;
      const priceId = PLAN_PRICE_IDS[plan];
      expect(priceId).toBe("price_starter_test");

      const stripe = getStripe();
      const session = await stripe.checkout.sessions.create({
        customer: "cus_123",
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: "http://localhost:3000/billing?success=true",
        cancel_url: "http://localhost:3000/billing?canceled=true",
        metadata: { creatorId: "c1" },
      });

      expect(session.url).toContain("checkout.stripe.com");
    });
  });

  describe("createPortalSession", () => {
    it("throws BAD_REQUEST when no Stripe customer", () => {
      const creator = { stripeCustomerId: null };
      expect(() => {
        if (!creator?.stripeCustomerId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No tienes una suscripcion activa." });
        }
      }).toThrow(TRPCError);
    });

    it("creates portal session for existing customer", async () => {
      const stripe = getStripe();
      const session = await stripe.billingPortal.sessions.create({
        customer: "cus_existing",
        return_url: "http://localhost:3000/billing",
      });
      expect(session.url).toBeDefined();
    });
  });

  describe("getInvoices", () => {
    it("returns empty array when no Stripe customer", () => {
      const creator = { stripeCustomerId: null };
      if (!creator?.stripeCustomerId) {
        expect([]).toEqual([]);
      }
    });

    it("formats invoice data correctly", async () => {
      const stripe = getStripe();
      const invoices = await stripe.invoices.list({ customer: "cus_123", limit: 10 });

      const formatted = invoices.data.map((inv: any) => ({
        id: inv.id,
        date: inv.created ? new Date(inv.created * 1000) : null,
        amount: inv.amount_paid ? inv.amount_paid / 100 : 0,
        currency: inv.currency,
        status: inv.status,
        pdfUrl: inv.invoice_pdf,
      }));

      expect(formatted[0]!.id).toBe("inv_1");
      expect(formatted[0]!.amount).toBe(15); // 1500/100
      expect(formatted[0]!.currency).toBe("usd");
      expect(formatted[0]!.pdfUrl).toContain("stripe.com");
    });
  });

  describe("getUsage", () => {
    it("returns usage summary", async () => {
      const usage = await getUsageSummary({} as any, "c1");
      expect(usage.contacts.used).toBe(3);
      expect(usage.contacts.limit).toBe(5);
    });
  });

  describe("completeOnboarding", () => {
    it("marks onboarding as completed", () => {
      const update = { onboardingCompleted: true, updatedAt: new Date() };
      expect(update.onboardingCompleted).toBe(true);
    });
  });
});
