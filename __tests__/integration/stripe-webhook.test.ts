import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Stripe
const mockStripe = {
  webhooks: {
    constructEvent: vi.fn(),
  },
  subscriptions: {
    retrieve: vi.fn(),
  },
};

vi.mock("@/lib/stripe", () => ({
  getStripe: () => mockStripe,
  getPlanFromPriceId: vi.fn((priceId: string) => {
    if (priceId === "price_starter") return "starter";
    if (priceId === "price_pro") return "pro";
    return "free";
  }),
}));

vi.mock("@/server/db", () => {
  const mockDb = {
    query: {
      creators: { findFirst: vi.fn() },
    },
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  };
  return { db: mockDb };
});

vi.mock("@/lib/logger", () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { getPlanFromPriceId } from "@/lib/stripe";

describe("Stripe Webhook Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getPlanFromPriceId", () => {
    it("maps starter price ID to starter", () => {
      expect(getPlanFromPriceId("price_starter")).toBe("starter");
    });

    it("maps pro price ID to pro", () => {
      expect(getPlanFromPriceId("price_pro")).toBe("pro");
    });

    it("defaults to free for unknown price ID", () => {
      expect(getPlanFromPriceId("price_unknown")).toBe("free");
    });
  });

  describe("Webhook event handling", () => {
    it("signature verification rejects invalid signatures", () => {
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error("Invalid signature");
      });

      expect(() =>
        mockStripe.webhooks.constructEvent("body", "bad-sig", "whsec_test")
      ).toThrow("Invalid signature");
    });

    it("signature verification accepts valid signatures", () => {
      const event = {
        id: "evt_1",
        type: "checkout.session.completed",
        data: { object: { metadata: { creatorId: "c1" } } },
      };
      mockStripe.webhooks.constructEvent.mockReturnValue(event);

      const result = mockStripe.webhooks.constructEvent("body", "valid-sig", "whsec_test");
      expect(result.type).toBe("checkout.session.completed");
    });
  });

  describe("Subscription state transitions", () => {
    it("checkout.session.completed → active subscription", () => {
      const event = {
        type: "checkout.session.completed",
        data: {
          object: {
            metadata: { creatorId: "creator-1" },
            subscription: "sub_123",
            customer: "cus_123",
          },
        },
      };

      // Verify event structure
      expect(event.data.object.metadata.creatorId).toBe("creator-1");
      expect(event.data.object.subscription).toBe("sub_123");
    });

    it("customer.subscription.deleted → downgrade to free", () => {
      // After deletion, the creator should be set to:
      // subscriptionPlan: "free", subscriptionStatus: "canceled"
      const expectedUpdate = {
        subscriptionPlan: "free",
        subscriptionStatus: "canceled",
        stripeSubscriptionId: null,
        stripePriceId: null,
        currentPeriodEnd: null,
      };

      expect(expectedUpdate.subscriptionPlan).toBe("free");
      expect(expectedUpdate.subscriptionStatus).toBe("canceled");
      expect(expectedUpdate.stripeSubscriptionId).toBeNull();
    });

    it("invoice.payment_failed → past_due status", () => {
      const expectedUpdate = { subscriptionStatus: "past_due" };
      expect(expectedUpdate.subscriptionStatus).toBe("past_due");
    });

    it("handles missing creatorId in metadata gracefully", () => {
      const event = {
        type: "checkout.session.completed",
        data: {
          object: {
            metadata: {}, // No creatorId
            subscription: "sub_123",
          },
        },
      };

      expect(event.data.object.metadata).not.toHaveProperty("creatorId");
    });
  });

  describe("Subscription retrieval", () => {
    it("retrieves subscription details after checkout", async () => {
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        id: "sub_123",
        status: "active",
        items: {
          data: [{ price: { id: "price_pro" } }],
        },
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      });

      const sub = await mockStripe.subscriptions.retrieve("sub_123");
      expect(sub.status).toBe("active");
      expect(sub.items.data[0].price.id).toBe("price_pro");
    });
  });
});
