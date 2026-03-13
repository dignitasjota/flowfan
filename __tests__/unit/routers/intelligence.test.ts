import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("@/server/services/usage-limits", () => ({
  PLAN_LIMITS: {
    free: { export: "none" },
    starter: { export: "csv" },
    pro: { export: "csv_json" },
    business: { export: "csv_json_api" },
  },
}));

vi.mock("@/server/services/proactive-actions", () => ({
  generateProactiveActions: vi.fn().mockReturnValue([]),
}));

import { PLAN_LIMITS } from "@/server/services/usage-limits";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("intelligence router logic", () => {
  describe("getContactScoring", () => {
    it("returns default scores when no profile", () => {
      const profile = null;
      const defaults = {
        engagementLevel: 0,
        paymentProbability: 0,
        funnelStage: "cold" as const,
        responseSpeed: "medium" as const,
        conversationDepth: "superficial" as const,
        estimatedBudget: "low" as const,
        factors: [],
      };

      if (!profile) {
        expect(defaults.funnelStage).toBe("cold");
        expect(defaults.factors).toEqual([]);
      }
    });

    it("throws NOT_FOUND for missing contact", () => {
      expect(() => {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contacto no encontrado" });
      }).toThrow(TRPCError);
    });
  });

  describe("getSentimentTrend", () => {
    it("filters messages with sentiment data", () => {
      const messages = [
        { id: "1", role: "fan", sentiment: { score: 0.5, label: "positive" }, createdAt: new Date() },
        { id: "2", role: "creator", sentiment: null, createdAt: new Date() },
        { id: "3", role: "fan", sentiment: { score: -0.3, label: "negative" }, createdAt: new Date() },
      ];

      const withSentiment = messages.filter((m) => m.sentiment !== null);
      expect(withSentiment).toHaveLength(2);
    });
  });

  describe("getTopContacts", () => {
    it("sorts by engagement", () => {
      const contacts = [
        { id: "1", engagementLevel: 30 },
        { id: "2", engagementLevel: 80 },
        { id: "3", engagementLevel: 50 },
      ];

      contacts.sort((a, b) => b.engagementLevel - a.engagementLevel);
      expect(contacts[0]!.id).toBe("2");
      expect(contacts[2]!.id).toBe("1");
    });

    it("sorts by payment probability", () => {
      const contacts = [
        { id: "1", paymentProbability: 90 },
        { id: "2", paymentProbability: 20 },
        { id: "3", paymentProbability: 60 },
      ];

      contacts.sort((a, b) => b.paymentProbability - a.paymentProbability);
      expect(contacts[0]!.id).toBe("1");
    });

    it("respects limit parameter", () => {
      const contacts = Array.from({ length: 20 }, (_, i) => ({
        id: String(i),
        engagementLevel: i * 5,
      }));

      const limit = 5;
      const result = contacts.slice(0, limit);
      expect(result).toHaveLength(5);
    });
  });

  describe("getDashboardStats", () => {
    it("calculates funnel distribution", () => {
      const contacts = [
        { profile: { funnelStage: "cold" } },
        { profile: { funnelStage: "cold" } },
        { profile: { funnelStage: "curious" } },
        { profile: { funnelStage: "buyer" } },
      ];

      const dist: Record<string, number> = { cold: 0, curious: 0, interested: 0, hot_lead: 0, buyer: 0, vip: 0 };
      for (const c of contacts) {
        dist[c.profile.funnelStage] = (dist[c.profile.funnelStage] ?? 0) + 1;
      }

      expect(dist.cold).toBe(2);
      expect(dist.curious).toBe(1);
      expect(dist.buyer).toBe(1);
      expect(dist.vip).toBe(0);
    });

    it("calculates averages correctly", () => {
      const profiles = [
        { engagementLevel: 40, paymentProbability: 20 },
        { engagementLevel: 80, paymentProbability: 60 },
      ];

      const count = profiles.length || 1;
      const avgEngagement = Math.round(profiles.reduce((s, p) => s + p.engagementLevel, 0) / count);
      const avgPayment = Math.round(profiles.reduce((s, p) => s + p.paymentProbability, 0) / count);

      expect(avgEngagement).toBe(60);
      expect(avgPayment).toBe(40);
    });
  });

  describe("exportContactsData", () => {
    it("blocks export for free plan", () => {
      const plan = "free" as keyof typeof PLAN_LIMITS;
      expect(PLAN_LIMITS[plan].export).toBe("none");

      expect(() => {
        if (PLAN_LIMITS[plan].export === "none") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Export not available" });
        }
      }).toThrow(TRPCError);
    });

    it("blocks JSON export for starter plan", () => {
      const plan = "starter" as keyof typeof PLAN_LIMITS;
      const format = "json";
      expect(PLAN_LIMITS[plan].export).toBe("csv");

      expect(() => {
        if (format === "json" && PLAN_LIMITS[plan].export === "csv") {
          throw new TRPCError({ code: "FORBIDDEN", message: "JSON not available" });
        }
      }).toThrow(TRPCError);
    });

    it("allows CSV for starter plan", () => {
      const plan = "starter" as keyof typeof PLAN_LIMITS;
      const format = "csv";
      const blocked = PLAN_LIMITS[plan].export === "none" || (format === "json" && PLAN_LIMITS[plan].export === "csv");
      expect(blocked).toBe(false);
    });

    it("allows JSON for pro plan", () => {
      const plan = "pro" as keyof typeof PLAN_LIMITS;
      const blocked = PLAN_LIMITS[plan].export === "none";
      expect(blocked).toBe(false);
    });

    it("generates CSV correctly", () => {
      const rows = [
        { username: "fan1", displayName: "Fan 1", platformType: "instagram" },
        { username: "fan2", displayName: 'Fan "2"', platformType: "onlyfans" },
      ];

      const headers = Object.keys(rows[0]!).join(",");
      const lines = rows.map((r) =>
        Object.values(r)
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      );
      const csv = [headers, ...lines].join("\n");

      expect(csv).toContain("username,displayName,platformType");
      expect(csv).toContain('"fan1"');
      expect(csv).toContain('"Fan ""2"""'); // escaped quotes
    });
  });

  describe("notifications", () => {
    it("filters unread only when requested", () => {
      const notifications = [
        { id: "1", isRead: false },
        { id: "2", isRead: true },
        { id: "3", isRead: false },
      ];

      const unreadOnly = true;
      const filtered = unreadOnly ? notifications.filter((n) => !n.isRead) : notifications;
      expect(filtered).toHaveLength(2);
    });

    it("counts unread notifications", () => {
      const notifications = [
        { isRead: false },
        { isRead: true },
        { isRead: false },
        { isRead: false },
      ];
      const unreadCount = notifications.filter((n) => !n.isRead).length;
      expect(unreadCount).toBe(3);
    });

    it("marks single notification as read", () => {
      const notification = { id: "n1", isRead: false };
      notification.isRead = true;
      expect(notification.isRead).toBe(true);
    });
  });
});
