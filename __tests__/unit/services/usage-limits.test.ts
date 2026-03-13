import { describe, it, expect } from "vitest";
import { PLAN_LIMITS } from "@/server/services/usage-limits";

describe("PLAN_LIMITS", () => {
  describe("free plan", () => {
    const free = PLAN_LIMITS.free;

    it("has correct contact limit", () => {
      expect(free.contacts).toBe(5);
    });

    it("has correct AI message limit", () => {
      expect(free.aiMessagesPerMonth).toBe(20);
    });

    it("allows only 1 platform", () => {
      expect(free.platforms).toBe(1);
    });

    it("allows 3 templates", () => {
      expect(free.templates).toBe(3);
    });

    it("has 0 reports (feature disabled)", () => {
      expect(free.reportsPerMonth).toBe(0);
    });

    it("does not have priceAdvisor", () => {
      expect(free.priceAdvisor).toBe(false);
    });

    it("does not have multiModel", () => {
      expect(free.multiModel).toBe(false);
    });

    it("has no export capability", () => {
      expect(free.export).toBe("none");
    });
  });

  describe("starter plan", () => {
    const starter = PLAN_LIMITS.starter;

    it("has 50 contacts", () => {
      expect(starter.contacts).toBe(50);
    });

    it("has 200 AI messages/month", () => {
      expect(starter.aiMessagesPerMonth).toBe(200);
    });

    it("allows 3 platforms", () => {
      expect(starter.platforms).toBe(3);
    });

    it("allows 20 templates", () => {
      expect(starter.templates).toBe(20);
    });

    it("allows 5 reports/month", () => {
      expect(starter.reportsPerMonth).toBe(5);
    });

    it("has CSV export only", () => {
      expect(starter.export).toBe("csv");
    });

    it("does not have priceAdvisor", () => {
      expect(starter.priceAdvisor).toBe(false);
    });
  });

  describe("pro plan", () => {
    const pro = PLAN_LIMITS.pro;

    it("has unlimited contacts", () => {
      expect(pro.contacts).toBe(-1);
    });

    it("has 2000 AI messages/month", () => {
      expect(pro.aiMessagesPerMonth).toBe(2000);
    });

    it("has unlimited platforms", () => {
      expect(pro.platforms).toBe(-1);
    });

    it("has unlimited templates", () => {
      expect(pro.templates).toBe(-1);
    });

    it("has unlimited reports", () => {
      expect(pro.reportsPerMonth).toBe(-1);
    });

    it("has priceAdvisor", () => {
      expect(pro.priceAdvisor).toBe(true);
    });

    it("has multiModel", () => {
      expect(pro.multiModel).toBe(true);
    });

    it("has CSV + JSON export", () => {
      expect(pro.export).toBe("csv_json");
    });
  });

  describe("business plan", () => {
    const business = PLAN_LIMITS.business;

    it("has unlimited everything", () => {
      expect(business.contacts).toBe(-1);
      expect(business.aiMessagesPerMonth).toBe(-1);
      expect(business.platforms).toBe(-1);
      expect(business.templates).toBe(-1);
      expect(business.reportsPerMonth).toBe(-1);
    });

    it("has all features", () => {
      expect(business.priceAdvisor).toBe(true);
      expect(business.multiModel).toBe(true);
    });

    it("has full export including API", () => {
      expect(business.export).toBe("csv_json_api");
    });
  });

  describe("plan hierarchy", () => {
    it("each plan has equal or higher limits than the previous", () => {
      const plans = ["free", "starter", "pro", "business"] as const;
      const numericFields = ["contacts", "aiMessagesPerMonth", "platforms", "templates", "reportsPerMonth"] as const;

      for (let i = 1; i < plans.length; i++) {
        const prev = PLAN_LIMITS[plans[i - 1]!];
        const curr = PLAN_LIMITS[plans[i]!];

        for (const field of numericFields) {
          // -1 means unlimited, so it's always >= any positive number
          if (curr[field] === -1) continue;
          if (prev[field] === -1) {
            // Previous was unlimited but current is not — this shouldn't happen
            expect(curr[field]).toBe(-1);
            continue;
          }
          expect(curr[field]).toBeGreaterThanOrEqual(prev[field]);
        }
      }
    });

    it("pro+ plans unlock premium features", () => {
      expect(PLAN_LIMITS.free.priceAdvisor).toBe(false);
      expect(PLAN_LIMITS.starter.priceAdvisor).toBe(false);
      expect(PLAN_LIMITS.pro.priceAdvisor).toBe(true);
      expect(PLAN_LIMITS.business.priceAdvisor).toBe(true);
    });
  });
});
