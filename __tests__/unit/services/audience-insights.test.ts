import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { computeAudienceInsights } from "@/server/services/audience-insights";

type StatsRow = {
  platform_type: string;
  contact_count: number;
  avg_engagement: number;
  avg_payment: number;
  avg_churn: number;
  cold: number;
  curious: number;
  interested: number;
  hot_lead: number;
  buyer: number;
  vip: number;
};

type RevenueRow = {
  platform_type: string;
  revenue_cents: number;
  txn_count: number;
};

function makeDb(opts: {
  stats?: StatsRow[];
  revenue?: RevenueRow[];
  profiles?: Array<{ platformType: string; signals: Record<string, unknown> | null }>;
}) {
  let executeCallCount = 0;
  return {
    execute: vi.fn().mockImplementation(() => {
      executeCallCount++;
      // 1st execute = stats, 2nd execute = revenue
      if (executeCallCount === 1) {
        return Promise.resolve({ rows: opts.stats ?? [] });
      }
      return Promise.resolve({ rows: opts.revenue ?? [] });
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockResolvedValue(opts.profiles ?? []),
            }),
          }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("computeAudienceInsights", () => {
  it("returns zero totals when no data", async () => {
    const db = makeDb({});
    const result = await computeAudienceInsights(db as never, "creator-1");

    expect(result.perPlatform).toEqual([]);
    expect(result.totals.contactCount).toBe(0);
    expect(result.totals.avgEngagement).toBe(0);
    expect(result.totals.avgPayment).toBe(0);
    expect(result.totals.revenueCents).toBe(0);
    expect(result.totals.conversionRate).toBe(0);
  });

  it("computes per-platform conversion rate (buyer + vip / total)", async () => {
    const db = makeDb({
      stats: [
        {
          platform_type: "instagram",
          contact_count: 100,
          avg_engagement: 50,
          avg_payment: 30,
          avg_churn: 20,
          cold: 30,
          curious: 30,
          interested: 20,
          hot_lead: 10,
          buyer: 7,
          vip: 3,
        },
      ],
    });
    const result = await computeAudienceInsights(db as never, "creator-1");

    expect(result.perPlatform).toHaveLength(1);
    const ig = result.perPlatform[0];
    expect(ig.contactCount).toBe(100);
    expect(ig.conversionRate).toBe(10); // (7 + 3) / 100 = 10%
    expect(ig.funnelDistribution.buyer).toBe(7);
    expect(ig.funnelDistribution.vip).toBe(3);
  });

  it("merges revenue data per platform", async () => {
    const db = makeDb({
      stats: [
        {
          platform_type: "reddit",
          contact_count: 50,
          avg_engagement: 40,
          avg_payment: 25,
          avg_churn: 15,
          cold: 20,
          curious: 15,
          interested: 10,
          hot_lead: 3,
          buyer: 1,
          vip: 1,
        },
      ],
      revenue: [
        { platform_type: "reddit", revenue_cents: 12500, txn_count: 4 },
      ],
    });
    const result = await computeAudienceInsights(db as never, "creator-1");

    expect(result.perPlatform[0].revenueCents).toBe(12500);
    expect(result.perPlatform[0].transactionCount).toBe(4);
  });

  it("falls back to 0 when revenue not present for a platform", async () => {
    const db = makeDb({
      stats: [
        {
          platform_type: "twitter",
          contact_count: 20,
          avg_engagement: 30,
          avg_payment: 10,
          avg_churn: 50,
          cold: 18,
          curious: 1,
          interested: 1,
          hot_lead: 0,
          buyer: 0,
          vip: 0,
        },
      ],
      // No revenue rows for twitter
    });
    const result = await computeAudienceInsights(db as never, "creator-1");
    expect(result.perPlatform[0].revenueCents).toBe(0);
    expect(result.perPlatform[0].transactionCount).toBe(0);
  });

  it("computes weighted average for global totals", async () => {
    // 100 IG contacts at engagement 50, 50 reddit contacts at engagement 80
    // Weighted: (100*50 + 50*80) / 150 = 9000 / 150 = 60
    const db = makeDb({
      stats: [
        {
          platform_type: "instagram",
          contact_count: 100,
          avg_engagement: 50,
          avg_payment: 30,
          avg_churn: 20,
          cold: 50,
          curious: 30,
          interested: 10,
          hot_lead: 5,
          buyer: 3,
          vip: 2,
        },
        {
          platform_type: "reddit",
          contact_count: 50,
          avg_engagement: 80,
          avg_payment: 60,
          avg_churn: 10,
          cold: 5,
          curious: 10,
          interested: 15,
          hot_lead: 10,
          buyer: 5,
          vip: 5,
        },
      ],
    });
    const result = await computeAudienceInsights(db as never, "creator-1");

    expect(result.totals.contactCount).toBe(150);
    expect(result.totals.avgEngagement).toBe(60); // weighted by count
    // Total buyers + vips = (3+2) + (5+5) = 15. Conversion = 15/150 = 10%
    expect(result.totals.conversionRate).toBe(10);
  });

  it("aggregates top topics from behavioral signals across platforms", async () => {
    const db = makeDb({
      stats: [
        {
          platform_type: "instagram",
          contact_count: 3,
          avg_engagement: 50,
          avg_payment: 30,
          avg_churn: 20,
          cold: 1,
          curious: 1,
          interested: 1,
          hot_lead: 0,
          buyer: 0,
          vip: 0,
        },
      ],
      profiles: [
        {
          platformType: "instagram",
          signals: { topicFrequency: { food: 5, fitness: 3 } },
        },
        {
          platformType: "instagram",
          signals: { topicFrequency: { food: 2, travel: 4 } },
        },
        {
          platformType: "reddit",
          signals: { topicFrequency: { gaming: 10 } },
        },
      ],
    });
    const result = await computeAudienceInsights(db as never, "creator-1");

    const ig = result.perPlatform.find((p) => p.platformType === "instagram");
    expect(ig).toBeDefined();
    const topics = Object.fromEntries(
      ig!.topTopics.map((t) => [t.topic, t.frequency])
    );
    // food appears in 2 IG profiles: 5 + 2 = 7
    expect(topics.food).toBe(7);
    expect(topics.fitness).toBe(3);
    expect(topics.travel).toBe(4);
    // gaming was on reddit, NOT on instagram
    expect(topics.gaming).toBeUndefined();
  });

  it("orders platforms by contact count descending", async () => {
    const db = makeDb({
      stats: [
        {
          platform_type: "twitter",
          contact_count: 10,
          avg_engagement: 0,
          avg_payment: 0,
          avg_churn: 0,
          cold: 10,
          curious: 0,
          interested: 0,
          hot_lead: 0,
          buyer: 0,
          vip: 0,
        },
        {
          platform_type: "instagram",
          contact_count: 100,
          avg_engagement: 0,
          avg_payment: 0,
          avg_churn: 0,
          cold: 100,
          curious: 0,
          interested: 0,
          hot_lead: 0,
          buyer: 0,
          vip: 0,
        },
        {
          platform_type: "reddit",
          contact_count: 50,
          avg_engagement: 0,
          avg_payment: 0,
          avg_churn: 0,
          cold: 50,
          curious: 0,
          interested: 0,
          hot_lead: 0,
          buyer: 0,
          vip: 0,
        },
      ],
    });
    const result = await computeAudienceInsights(db as never, "creator-1");

    expect(result.perPlatform.map((p) => p.platformType)).toEqual([
      "instagram",
      "reddit",
      "twitter",
    ]);
  });
});
