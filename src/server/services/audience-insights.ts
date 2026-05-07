import { eq, and, gte, sql, desc } from "drizzle-orm";
import {
  contacts,
  contactProfiles,
  fanTransactions,
} from "@/server/db/schema";

type DB =
  | Parameters<Parameters<typeof import("@/server/db").db.transaction>[0]>[0]
  | typeof import("@/server/db").db;

export type FunnelDistribution = {
  cold: number;
  curious: number;
  interested: number;
  hot_lead: number;
  buyer: number;
  vip: number;
};

export type PlatformInsights = {
  platformType: string;
  contactCount: number;
  avgEngagement: number;
  avgPayment: number;
  avgChurn: number;
  funnelDistribution: FunnelDistribution;
  conversionRate: number; // % of contacts at buyer or vip
  revenueCents: number;
  transactionCount: number;
  topTopics: { topic: string; frequency: number }[];
};

export type AudienceInsights = {
  perPlatform: PlatformInsights[];
  totals: {
    contactCount: number;
    avgEngagement: number;
    avgPayment: number;
    revenueCents: number;
    conversionRate: number;
  };
  generatedAt: string;
};

const FUNNEL_STAGES = [
  "cold",
  "curious",
  "interested",
  "hot_lead",
  "buyer",
  "vip",
] as const;

type StatsRow = {
  platform_type: string;
  contact_count: string | number;
  avg_engagement: string | number | null;
  avg_payment: string | number | null;
  avg_churn: string | number | null;
  cold: string | number;
  curious: string | number;
  interested: string | number;
  hot_lead: string | number;
  buyer: string | number;
  vip: string | number;
};

type RevenueRow = {
  platform_type: string;
  revenue_cents: string | number | null;
  txn_count: string | number;
};

const num = (v: string | number | null | undefined): number =>
  v === null || v === undefined ? 0 : typeof v === "number" ? v : Number(v);

export async function computeAudienceInsights(
  db: DB,
  creatorId: string,
  options?: { sinceDays?: number }
): Promise<AudienceInsights> {
  const sinceDays = options?.sinceDays ?? 30;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  // 1. Per-platform stats (count, avgs, funnel breakdown)
  const statsResult = await (db as any).execute(sql`
    SELECT
      c.platform_type,
      COUNT(*)::int AS contact_count,
      AVG(p.engagement_level)::int AS avg_engagement,
      AVG(p.payment_probability)::int AS avg_payment,
      AVG(p.churn_score)::int AS avg_churn,
      COUNT(*) FILTER (WHERE p.funnel_stage = 'cold')::int AS cold,
      COUNT(*) FILTER (WHERE p.funnel_stage = 'curious')::int AS curious,
      COUNT(*) FILTER (WHERE p.funnel_stage = 'interested')::int AS interested,
      COUNT(*) FILTER (WHERE p.funnel_stage = 'hot_lead')::int AS hot_lead,
      COUNT(*) FILTER (WHERE p.funnel_stage = 'buyer')::int AS buyer,
      COUNT(*) FILTER (WHERE p.funnel_stage = 'vip')::int AS vip
    FROM ${contacts} c
    LEFT JOIN ${contactProfiles} p ON p.contact_id = c.id
    WHERE c.creator_id = ${creatorId} AND c.is_archived = false
    GROUP BY c.platform_type
  `);
  const statsRows = (statsResult as { rows?: StatsRow[] }).rows ?? (statsResult as StatsRow[]);

  // 2. Per-platform revenue within window
  const revResult = await (db as any).execute(sql`
    SELECT
      c.platform_type,
      COALESCE(SUM(t.amount), 0)::int AS revenue_cents,
      COUNT(t.id)::int AS txn_count
    FROM ${contacts} c
    LEFT JOIN ${fanTransactions} t
      ON t.contact_id = c.id
      AND t.transaction_date >= ${since}
    WHERE c.creator_id = ${creatorId}
    GROUP BY c.platform_type
  `);
  const revRows = (revResult as { rows?: RevenueRow[] }).rows ?? (revResult as RevenueRow[]);
  const revByPlatform = new Map<string, { revenueCents: number; transactionCount: number }>();
  for (const r of revRows) {
    revByPlatform.set(r.platform_type, {
      revenueCents: num(r.revenue_cents),
      transactionCount: num(r.txn_count),
    });
  }

  // 3. Top topics: aggregated from the most engaged 200 profiles per platform.
  // We pull profiles + signals JSONB and aggregate in JS. This avoids a more
  // complex SQL with jsonb_each but caps work to a known volume.
  const profiles = await (db as any)
    .select({
      platformType: contacts.platformType,
      signals: contactProfiles.behavioralSignals,
    })
    .from(contacts)
    .innerJoin(contactProfiles, eq(contactProfiles.contactId, contacts.id))
    .where(
      and(eq(contacts.creatorId, creatorId), eq(contacts.isArchived, false))
    )
    .orderBy(desc(contactProfiles.engagementLevel))
    .limit(500);

  const topicsByPlatform = new Map<string, Map<string, number>>();
  for (const row of profiles as Array<{
    platformType: string;
    signals: Record<string, unknown> | null;
  }>) {
    const freq = (row.signals as { topicFrequency?: Record<string, number> })
      ?.topicFrequency;
    if (!freq) continue;
    const platformMap = topicsByPlatform.get(row.platformType) ?? new Map();
    for (const [topic, count] of Object.entries(freq)) {
      platformMap.set(topic, (platformMap.get(topic) ?? 0) + count);
    }
    topicsByPlatform.set(row.platformType, platformMap);
  }

  // 4. Compose result
  const perPlatform: PlatformInsights[] = [];
  for (const row of statsRows) {
    const buyer = num(row.buyer);
    const vip = num(row.vip);
    const total = num(row.contact_count);
    const conversion = total > 0 ? Math.round(((buyer + vip) / total) * 100) : 0;
    const rev = revByPlatform.get(row.platform_type) ?? {
      revenueCents: 0,
      transactionCount: 0,
    };
    const topicMap = topicsByPlatform.get(row.platform_type) ?? new Map();
    const topTopics = Array.from(topicMap.entries())
      .map(([topic, frequency]) => ({ topic, frequency }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 8);

    perPlatform.push({
      platformType: row.platform_type,
      contactCount: total,
      avgEngagement: num(row.avg_engagement),
      avgPayment: num(row.avg_payment),
      avgChurn: num(row.avg_churn),
      funnelDistribution: {
        cold: num(row.cold),
        curious: num(row.curious),
        interested: num(row.interested),
        hot_lead: num(row.hot_lead),
        buyer,
        vip,
      },
      conversionRate: conversion,
      revenueCents: rev.revenueCents,
      transactionCount: rev.transactionCount,
      topTopics,
    });
  }

  perPlatform.sort((a, b) => b.contactCount - a.contactCount);

  const totalContacts = perPlatform.reduce((s, p) => s + p.contactCount, 0);
  const weightedEngagement =
    totalContacts > 0
      ? Math.round(
          perPlatform.reduce(
            (s, p) => s + p.avgEngagement * p.contactCount,
            0
          ) / totalContacts
        )
      : 0;
  const weightedPayment =
    totalContacts > 0
      ? Math.round(
          perPlatform.reduce((s, p) => s + p.avgPayment * p.contactCount, 0) /
            totalContacts
        )
      : 0;
  const totalBuyers = perPlatform.reduce(
    (s, p) => s + p.funnelDistribution.buyer + p.funnelDistribution.vip,
    0
  );
  const totalRevenue = perPlatform.reduce((s, p) => s + p.revenueCents, 0);

  return {
    perPlatform,
    totals: {
      contactCount: totalContacts,
      avgEngagement: weightedEngagement,
      avgPayment: weightedPayment,
      revenueCents: totalRevenue,
      conversionRate:
        totalContacts > 0
          ? Math.round((totalBuyers / totalContacts) * 100)
          : 0,
    },
    generatedAt: new Date().toISOString(),
  };
}

export const FUNNEL_LABELS: Record<keyof FunnelDistribution, string> = {
  cold: "Frío",
  curious: "Curioso",
  interested: "Interesado",
  hot_lead: "Hot Lead",
  buyer: "Comprador",
  vip: "VIP",
};

export const FUNNEL_ORDER = FUNNEL_STAGES;
