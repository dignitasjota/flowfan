import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db";
import { authenticateApiKey } from "@/server/api/middleware/api-key-auth";
import { contacts, contactProfiles, fanTransactions } from "@/server/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Funnel distribution
  const funnelRows = await db
    .select({
      funnelStage: contactProfiles.funnelStage,
      count: sql<number>`count(*)`,
    })
    .from(contactProfiles)
    .innerJoin(contacts, eq(contactProfiles.contactId, contacts.id))
    .where(eq(contacts.creatorId, auth.creatorId))
    .groupBy(contactProfiles.funnelStage);

  // Total contacts
  const [totalContacts] = await db
    .select({ count: sql<number>`count(*)` })
    .from(contacts)
    .where(eq(contacts.creatorId, auth.creatorId));

  // Revenue last 30 days
  const [revenue30d] = await db
    .select({ total: sql<number>`coalesce(sum(${fanTransactions.amount}), 0)` })
    .from(fanTransactions)
    .where(
      and(
        eq(fanTransactions.creatorId, auth.creatorId),
        gte(fanTransactions.transactionDate, thirtyDaysAgo)
      )
    );

  // Average engagement
  const [avgEngagement] = await db
    .select({ avg: sql<number>`coalesce(avg(${contactProfiles.engagementLevel}), 0)` })
    .from(contactProfiles)
    .innerJoin(contacts, eq(contactProfiles.contactId, contacts.id))
    .where(eq(contacts.creatorId, auth.creatorId));

  // Average payment probability
  const [avgPayment] = await db
    .select({ avg: sql<number>`coalesce(avg(${contactProfiles.paymentProbability}), 0)` })
    .from(contactProfiles)
    .innerJoin(contacts, eq(contactProfiles.contactId, contacts.id))
    .where(eq(contacts.creatorId, auth.creatorId));

  const funnel: Record<string, number> = {};
  for (const row of funnelRows) {
    funnel[row.funnelStage ?? "cold"] = Number(row.count);
  }

  return NextResponse.json({
    data: {
      totalContacts: Number(totalContacts?.count ?? 0),
      revenueLast30Days: Number(revenue30d?.total ?? 0),
      avgEngagement: Math.round(Number(avgEngagement?.avg ?? 0)),
      avgPaymentProbability: Math.round(Number(avgPayment?.avg ?? 0)),
      funnelDistribution: funnel,
    },
  });
}
