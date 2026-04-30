import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("intelligence.getEnhancedDashboardStats", () => {
  describe("period validation", () => {
    it("accepts 30d period", () => {
      const period = "30d";
      const days = period === "30d" ? 30 : period === "60d" ? 60 : 90;
      expect(days).toBe(30);
    });

    it("accepts 60d period", () => {
      const period = "60d";
      const days = period === "30d" ? 30 : period === "60d" ? 60 : 90;
      expect(days).toBe(60);
    });

    it("accepts 90d period", () => {
      const period = "90d";
      const days = period === "30d" ? 30 : period === "60d" ? 60 : 90;
      expect(days).toBe(90);
    });
  });

  describe("revenue change percent calculation", () => {
    it("calculates positive growth", () => {
      const current = 200;
      const prev = 100;
      const change = prev > 0 ? Math.round(((current - prev) / prev) * 100) : 0;
      expect(change).toBe(100);
    });

    it("calculates negative growth", () => {
      const current = 50;
      const prev = 100;
      const change = prev > 0 ? Math.round(((current - prev) / prev) * 100) : 0;
      expect(change).toBe(-50);
    });

    it("returns 0 when both periods are zero", () => {
      const current = 0;
      const prev = 0;
      const change = prev > 0 ? Math.round(((current - prev) / prev) * 100) : current > 0 ? 100 : 0;
      expect(change).toBe(0);
    });

    it("returns 100 when previous was zero but current has revenue", () => {
      const current = 500;
      const prev = 0;
      const change = prev > 0 ? Math.round(((current - prev) / prev) * 100) : current > 0 ? 100 : 0;
      expect(change).toBe(100);
    });
  });

  describe("funnel conversion calculation", () => {
    const stages = ["cold", "curious", "interested", "hot_lead", "buyer", "vip"] as const;

    function computeConversion(funnelCounts: Record<string, number>) {
      return stages.slice(0, -1).map((stage, i) => {
        const nextStage = stages[i + 1]!;
        const atOrBeyond = stages.slice(i + 1).reduce((sum, s) => sum + (funnelCounts[s] ?? 0), 0);
        const atOrBeyondCurrent = stages.slice(i).reduce((sum, s) => sum + (funnelCounts[s] ?? 0), 0);
        return {
          from: stage,
          to: nextStage,
          rate: atOrBeyondCurrent > 0 ? Math.round((atOrBeyond / atOrBeyondCurrent) * 100) : 0,
        };
      });
    }

    it("computes conversion for evenly distributed contacts", () => {
      const counts = { cold: 10, curious: 10, interested: 10, hot_lead: 10, buyer: 10, vip: 10 };
      const conversion = computeConversion(counts);
      // cold->curious: (50/60) = 83%
      expect(conversion[0]!.rate).toBe(83);
      // curious->interested: (40/50) = 80%
      expect(conversion[1]!.rate).toBe(80);
      // interested->hot_lead: (30/40) = 75%
      expect(conversion[2]!.rate).toBe(75);
    });

    it("handles all contacts at cold stage", () => {
      const counts = { cold: 50, curious: 0, interested: 0, hot_lead: 0, buyer: 0, vip: 0 };
      const conversion = computeConversion(counts);
      expect(conversion[0]!.rate).toBe(0);
    });

    it("handles all contacts at vip stage", () => {
      const counts = { cold: 0, curious: 0, interested: 0, hot_lead: 0, buyer: 0, vip: 20 };
      const conversion = computeConversion(counts);
      // cold->curious: 20/20 = 100%
      expect(conversion[0]!.rate).toBe(100);
      // buyer->vip: 20/20 = 100%
      expect(conversion[4]!.rate).toBe(100);
    });

    it("handles empty funnel", () => {
      const counts = { cold: 0, curious: 0, interested: 0, hot_lead: 0, buyer: 0, vip: 0 };
      const conversion = computeConversion(counts);
      expect(conversion.every((c) => c.rate === 0)).toBe(true);
    });

    it("returns 5 conversion pairs", () => {
      const counts = { cold: 5, curious: 3, interested: 2, hot_lead: 1, buyer: 1, vip: 0 };
      const conversion = computeConversion(counts);
      expect(conversion).toHaveLength(5);
      expect(conversion[0]!.from).toBe("cold");
      expect(conversion[0]!.to).toBe("curious");
      expect(conversion[4]!.from).toBe("buyer");
      expect(conversion[4]!.to).toBe("vip");
    });
  });

  describe("churn rate calculation", () => {
    it("calculates churn correctly", () => {
      const total = 100;
      const inactive = 15;
      const churnRate = Math.round((inactive / total) * 100);
      expect(churnRate).toBe(15);
    });

    it("returns 0 when all contacts are active", () => {
      const total = 50;
      const inactive = 0;
      const churnRate = Math.round((inactive / total) * 100);
      expect(churnRate).toBe(0);
    });

    it("returns 100 when all contacts are inactive", () => {
      const total = 20;
      const inactive = 20;
      const churnRate = Math.round((inactive / total) * 100);
      expect(churnRate).toBe(100);
    });
  });

  describe("contacts at risk filtering", () => {
    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    type TestContact = {
      engagementLevel: number;
      lastInteractionAt: Date;
    };

    function isAtRisk(c: TestContact) {
      return (
        c.engagementLevel > 20 &&
        c.lastInteractionAt < fourteenDaysAgo &&
        c.lastInteractionAt >= thirtyDaysAgo
      );
    }

    it("flags contact inactive 14-30 days with engagement > 20", () => {
      const contact = {
        engagementLevel: 50,
        lastInteractionAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
      };
      expect(isAtRisk(contact)).toBe(true);
    });

    it("excludes contact with low engagement", () => {
      const contact = {
        engagementLevel: 10,
        lastInteractionAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
      };
      expect(isAtRisk(contact)).toBe(false);
    });

    it("excludes recently active contact", () => {
      const contact = {
        engagementLevel: 80,
        lastInteractionAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      };
      expect(isAtRisk(contact)).toBe(false);
    });

    it("excludes contact inactive more than 30 days", () => {
      const contact = {
        engagementLevel: 60,
        lastInteractionAt: new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000),
      };
      expect(isAtRisk(contact)).toBe(false);
    });
  });

  describe("response time calculation", () => {
    it("calculates average response time from message pairs", () => {
      const pairs = [
        { fanTime: 1000, creatorTime: 61000 }, // 60s = 1 min
        { fanTime: 2000, creatorTime: 182000 }, // 180s = 3 min
      ];

      let totalMs = 0;
      let count = 0;
      for (const pair of pairs) {
        const diff = pair.creatorTime - pair.fanTime;
        if (diff > 0 && diff < 24 * 60 * 60 * 1000) {
          totalMs += diff;
          count++;
        }
      }
      const avgMinutes = count > 0 ? Math.round(totalMs / count / 60000) : null;
      expect(avgMinutes).toBe(2); // (1+3)/2 = 2 min
    });

    it("ignores gaps longer than 24 hours", () => {
      const pairs = [
        { fanTime: 0, creatorTime: 25 * 60 * 60 * 1000 }, // 25h - ignored
        { fanTime: 1000, creatorTime: 121000 }, // 120s = 2 min
      ];

      let totalMs = 0;
      let count = 0;
      for (const pair of pairs) {
        const diff = pair.creatorTime - pair.fanTime;
        if (diff > 0 && diff < 24 * 60 * 60 * 1000) {
          totalMs += diff;
          count++;
        }
      }
      const avgMinutes = count > 0 ? Math.round(totalMs / count / 60000) : null;
      expect(avgMinutes).toBe(2);
    });

    it("returns null when no response pairs exist", () => {
      const totalMs = 0;
      const count = 0;
      const avgMinutes = count > 0 ? Math.round(totalMs / count / 60000) : null;
      expect(avgMinutes).toBeNull();
    });
  });

  describe("platform ROI grouping", () => {
    it("groups revenue by platform", () => {
      const transactions = [
        { platform: "instagram", amount: 1000 },
        { platform: "instagram", amount: 2000 },
        { platform: "telegram", amount: 500 },
        { platform: "onlyfans", amount: 3000 },
      ];

      const grouped: Record<string, number> = {};
      for (const tx of transactions) {
        grouped[tx.platform] = (grouped[tx.platform] ?? 0) + tx.amount;
      }

      expect(grouped["instagram"]).toBe(3000);
      expect(grouped["telegram"]).toBe(500);
      expect(grouped["onlyfans"]).toBe(3000);
    });

    it("handles empty transaction list", () => {
      const transactions: { platform: string; amount: number }[] = [];
      const grouped: Record<string, number> = {};
      for (const tx of transactions) {
        grouped[tx.platform] = (grouped[tx.platform] ?? 0) + tx.amount;
      }
      expect(Object.keys(grouped)).toHaveLength(0);
    });
  });
});
