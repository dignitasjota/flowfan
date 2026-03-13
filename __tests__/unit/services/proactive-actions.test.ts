import { describe, it, expect } from "vitest";
import { generateProactiveActions, type ProactiveAction } from "@/server/services/proactive-actions";
import type { BehavioralSignals } from "@/server/services/scoring";

function makeContact(overrides: Record<string, unknown> = {}) {
  return {
    id: "contact-1",
    username: "testuser",
    displayName: null as string | null,
    platformType: "instagram",
    lastInteractionAt: new Date(),
    totalConversations: 3,
    profile: {
      engagementLevel: 50,
      paymentProbability: 30,
      funnelStage: "curious",
      estimatedBudget: "medium" as string | null,
      behavioralSignals: {
        messageCount: 10,
        avgMessageLength: 50,
        avgSentiment: 0.3,
        sentimentTrend: 0.05,
        avgPurchaseIntent: 0.2,
        maxPurchaseIntent: 0.4,
        topicFrequency: {},
        budgetMentions: [],
        lastMessageAt: new Date().toISOString(),
        avgTimeBetweenMessages: 60,
        conversationCount: 3,
      } as BehavioralSignals | Record<string, unknown> | null,
    },
    ...overrides,
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

describe("generateProactiveActions", () => {
  it("returns empty array for empty contacts", () => {
    expect(generateProactiveActions([])).toEqual([]);
  });

  it("skips contacts without profile", () => {
    const contact = makeContact({ profile: null });
    expect(generateProactiveActions([contact])).toEqual([]);
  });

  describe("retain action (inactive VIP/buyer)", () => {
    it("generates retain for inactive VIP (> 3 days)", () => {
      const contact = makeContact({
        lastInteractionAt: daysAgo(5),
        profile: { ...makeContact().profile, funnelStage: "vip" },
      });

      const actions = generateProactiveActions([contact]);
      const retains = actions.filter((a) => a.type === "retain");
      expect(retains.length).toBeGreaterThanOrEqual(1);
      expect(retains[0]!.priority).toBe("high");
    });

    it("generates retain for inactive buyer", () => {
      const contact = makeContact({
        lastInteractionAt: daysAgo(4),
        profile: { ...makeContact().profile, funnelStage: "buyer" },
      });

      const retains = generateProactiveActions([contact]).filter((a) => a.type === "retain");
      expect(retains.length).toBeGreaterThanOrEqual(1);
    });

    it("does NOT retain active VIP (< 3 days)", () => {
      const contact = makeContact({
        lastInteractionAt: daysAgo(1),
        profile: { ...makeContact().profile, funnelStage: "vip" },
      });

      const retains = generateProactiveActions([contact]).filter((a) => a.type === "retain");
      expect(retains).toHaveLength(0);
    });

    it("does NOT retain cold contacts regardless of inactivity", () => {
      const contact = makeContact({
        lastInteractionAt: daysAgo(10),
        profile: { ...makeContact().profile, funnelStage: "cold", engagementLevel: 5 },
      });

      const retains = generateProactiveActions([contact]).filter((a) => a.type === "retain");
      expect(retains).toHaveLength(0);
    });
  });

  describe("offer action (rising sentiment + high intent)", () => {
    it("generates offer for interested contact with rising sentiment", () => {
      const contact = makeContact({
        profile: {
          ...makeContact().profile,
          funnelStage: "interested",
          paymentProbability: 45,
          behavioralSignals: {
            ...makeContact().profile!.behavioralSignals,
            sentimentTrend: 0.2,
          },
        },
      });

      const offers = generateProactiveActions([contact]).filter((a) => a.type === "offer");
      expect(offers.length).toBeGreaterThanOrEqual(1);
      expect(offers[0]!.priority).toBe("high");
    });

    it("does NOT offer if sentiment trend is flat", () => {
      const contact = makeContact({
        profile: {
          ...makeContact().profile,
          funnelStage: "interested",
          paymentProbability: 45,
          behavioralSignals: {
            ...makeContact().profile!.behavioralSignals,
            sentimentTrend: 0.05, // below 0.1 threshold
          },
        },
      });

      const offers = generateProactiveActions([contact]).filter((a) => a.type === "offer");
      expect(offers).toHaveLength(0);
    });

    it("does NOT offer if payment probability < 40", () => {
      const contact = makeContact({
        profile: {
          ...makeContact().profile,
          funnelStage: "interested",
          paymentProbability: 30,
          behavioralSignals: {
            ...makeContact().profile!.behavioralSignals,
            sentimentTrend: 0.3,
          },
        },
      });

      const offers = generateProactiveActions([contact]).filter((a) => a.type === "offer");
      expect(offers).toHaveLength(0);
    });
  });

  describe("price action (budget mentions)", () => {
    it("generates price action for 2+ budget mentions", () => {
      const contact = makeContact({
        profile: {
          ...makeContact().profile,
          behavioralSignals: {
            ...makeContact().profile!.behavioralSignals,
            budgetMentions: ["$50", "$100"],
          },
        },
      });

      const prices = generateProactiveActions([contact]).filter((a) => a.type === "price");
      expect(prices.length).toBeGreaterThanOrEqual(1);
      expect(prices[0]!.priority).toBe("medium");
    });

    it("does NOT generate price action for 1 budget mention", () => {
      const contact = makeContact({
        profile: {
          ...makeContact().profile,
          behavioralSignals: {
            ...makeContact().profile!.behavioralSignals,
            budgetMentions: ["$50"],
          },
        },
      });

      const prices = generateProactiveActions([contact]).filter((a) => a.type === "price");
      expect(prices).toHaveLength(0);
    });
  });

  describe("engage action (curious + high engagement)", () => {
    it("generates engage for curious with high engagement and recent activity", () => {
      const contact = makeContact({
        lastInteractionAt: daysAgo(2),
        profile: {
          ...makeContact().profile,
          funnelStage: "curious",
          engagementLevel: 45,
        },
      });

      const engages = generateProactiveActions([contact]).filter((a) => a.type === "engage");
      expect(engages.length).toBeGreaterThanOrEqual(1);
      expect(engages[0]!.priority).toBe("medium");
    });

    it("does NOT engage if inactive > 7 days", () => {
      const contact = makeContact({
        lastInteractionAt: daysAgo(10),
        profile: {
          ...makeContact().profile,
          funnelStage: "curious",
          engagementLevel: 45,
        },
      });

      const engages = generateProactiveActions([contact]).filter((a) => a.type === "engage");
      expect(engages).toHaveLength(0);
    });

    it("does NOT engage if engagement < 40", () => {
      const contact = makeContact({
        lastInteractionAt: daysAgo(1),
        profile: {
          ...makeContact().profile,
          funnelStage: "curious",
          engagementLevel: 20,
        },
      });

      const engages = generateProactiveActions([contact]).filter((a) => a.type === "engage");
      expect(engages).toHaveLength(0);
    });
  });

  describe("followup action (general inactivity)", () => {
    it("generates followup for inactive contact with decent engagement", () => {
      const contact = makeContact({
        lastInteractionAt: daysAgo(10),
        profile: {
          ...makeContact().profile,
          funnelStage: "interested",
          engagementLevel: 30,
        },
      });

      const followups = generateProactiveActions([contact]).filter((a) => a.type === "followup");
      expect(followups.length).toBeGreaterThanOrEqual(1);
      expect(followups[0]!.priority).toBe("low");
    });

    it("does NOT followup cold contacts", () => {
      const contact = makeContact({
        lastInteractionAt: daysAgo(10),
        profile: {
          ...makeContact().profile,
          funnelStage: "cold",
          engagementLevel: 30,
        },
      });

      const followups = generateProactiveActions([contact]).filter((a) => a.type === "followup");
      expect(followups).toHaveLength(0);
    });
  });

  describe("priority sorting", () => {
    it("sorts actions by priority: high > medium > low", () => {
      const contacts = [
        // Will generate followup (low)
        makeContact({
          id: "c1",
          lastInteractionAt: daysAgo(10),
          profile: { ...makeContact().profile, funnelStage: "interested", engagementLevel: 30 },
        }),
        // Will generate retain (high)
        makeContact({
          id: "c2",
          lastInteractionAt: daysAgo(5),
          profile: { ...makeContact().profile, funnelStage: "vip" },
        }),
      ];

      const actions = generateProactiveActions(contacts);
      if (actions.length >= 2) {
        const priorities = actions.map((a) => a.priority);
        const highIdx = priorities.indexOf("high");
        const lowIdx = priorities.indexOf("low");
        if (highIdx >= 0 && lowIdx >= 0) {
          expect(highIdx).toBeLessThan(lowIdx);
        }
      }
    });
  });

  describe("multiple actions per contact", () => {
    it("can generate multiple actions for same contact", () => {
      const contact = makeContact({
        id: "multi",
        lastInteractionAt: daysAgo(5),
        profile: {
          ...makeContact().profile,
          funnelStage: "buyer",
          engagementLevel: 60,
          paymentProbability: 50,
          behavioralSignals: {
            ...makeContact().profile!.behavioralSignals,
            budgetMentions: ["$50", "$100"],
            sentimentTrend: 0.2,
          },
        },
      });

      const actions = generateProactiveActions([contact]);
      const contactActions = actions.filter((a) => a.contactId === "multi");
      // Should have at least retain (buyer inactive) + price (budget mentions)
      expect(contactActions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("displayName usage", () => {
    it("uses displayName in titles when available", () => {
      const contact = makeContact({
        displayName: "John Doe",
        lastInteractionAt: daysAgo(5),
        profile: { ...makeContact().profile, funnelStage: "vip" },
      });

      const actions = generateProactiveActions([contact]);
      const retain = actions.find((a) => a.type === "retain");
      expect(retain?.title).toContain("John Doe");
    });

    it("falls back to username when displayName is null", () => {
      const contact = makeContact({
        displayName: null,
        username: "cooluser",
        lastInteractionAt: daysAgo(5),
        profile: { ...makeContact().profile, funnelStage: "vip" },
      });

      const actions = generateProactiveActions([contact]);
      const retain = actions.find((a) => a.type === "retain");
      expect(retain?.title).toContain("cooluser");
    });
  });
});
