import { eq, gte, and, count, sql, sum } from "drizzle-orm";
import { contacts, messages, contactProfiles, fanTransactions, creators } from "@/server/db/schema";
import { emailQueue } from "@/server/queues";
import { createChildLogger } from "@/lib/logger";
import type { DailySummaryData, WeeklySummaryData } from "./email";

const log = createChildLogger("email-summary");

type DB = typeof import("@/server/db").db;

export async function generateDailySummary(db: DB, creatorId: string): Promise<DailySummaryData> {
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const creator = await db.query.creators.findFirst({
    where: eq(creators.id, creatorId),
    columns: { name: true },
  });

  // New contacts today
  const [newContactsResult] = await db
    .select({ count: count() })
    .from(contacts)
    .where(and(eq(contacts.creatorId, creatorId), gte(contacts.createdAt, startOfDay)));

  // Messages today (fan messages only)
  const [messagesResult] = await db
    .select({ count: count() })
    .from(messages)
    .innerJoin(
      sql`conversations ON conversations.id = ${messages.conversationId}`,
      sql`conversations.creator_id = ${creatorId}`
    )
    .where(and(eq(messages.role, "fan"), gte(messages.createdAt, startOfDay)));

  // At-risk contacts (churn score >= 50)
  const [atRiskResult] = await db
    .select({ count: count() })
    .from(contactProfiles)
    .innerJoin(contacts, eq(contacts.id, contactProfiles.contactId))
    .where(and(eq(contacts.creatorId, creatorId), gte(contactProfiles.engagementLevel, 20)));

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const atRiskContacts = await db
    .select({ count: count() })
    .from(contacts)
    .innerJoin(contactProfiles, eq(contactProfiles.contactId, contacts.id))
    .where(
      and(
        eq(contacts.creatorId, creatorId),
        gte(contactProfiles.engagementLevel, 20),
        sql`${contacts.lastInteractionAt} < ${fourteenDaysAgo}`,
        sql`${contacts.lastInteractionAt} >= ${thirtyDaysAgo}`
      )
    );

  return {
    creatorName: creator?.name ?? "Creador",
    newContacts: newContactsResult?.count ?? 0,
    totalMessages: messagesResult?.count ?? 0,
    atRiskCount: atRiskContacts[0]?.count ?? 0,
    topAction: (atRiskContacts[0]?.count ?? 0) > 0
      ? "Tienes contactos en riesgo de churn. Revisa tu dashboard."
      : "Todo va bien. Sigue asi!",
    date: today.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }),
  };
}

export async function generateWeeklySummary(db: DB, creatorId: string): Promise<WeeklySummaryData> {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);

  const creator = await db.query.creators.findFirst({
    where: eq(creators.id, creatorId),
    columns: { name: true },
  });

  // New contacts this week
  const [newContactsResult] = await db
    .select({ count: count() })
    .from(contacts)
    .where(and(eq(contacts.creatorId, creatorId), gte(contacts.createdAt, weekStart)));

  // Revenue this week
  const [revenueResult] = await db
    .select({ total: sum(fanTransactions.amountCents) })
    .from(fanTransactions)
    .innerJoin(contacts, eq(contacts.id, fanTransactions.contactId))
    .where(and(eq(contacts.creatorId, creatorId), gte(fanTransactions.createdAt, weekStart)));

  // Churn rate
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const allContacts = await db
    .select({ id: contacts.id, lastInteractionAt: contacts.lastInteractionAt })
    .from(contacts)
    .where(and(eq(contacts.creatorId, creatorId), eq(contacts.isArchived, false)));

  const totalActive = allContacts.length;
  const inactiveCount = allContacts.filter((c) => c.lastInteractionAt < thirtyDaysAgo).length;
  const churnRate = totalActive > 0 ? Math.round((inactiveCount / totalActive) * 100) : 0;

  // Top 5 contacts by engagement
  const topContacts = await db
    .select({
      name: sql<string>`COALESCE(${contacts.displayName}, ${contacts.username})`,
      stage: contactProfiles.funnelStage,
    })
    .from(contacts)
    .innerJoin(contactProfiles, eq(contactProfiles.contactId, contacts.id))
    .where(and(eq(contacts.creatorId, creatorId), eq(contacts.isArchived, false)))
    .orderBy(sql`${contactProfiles.engagementLevel} DESC`)
    .limit(5);

  const formatDate = (d: Date) => d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });

  return {
    creatorName: creator?.name ?? "Creador",
    newContacts: newContactsResult?.count ?? 0,
    revenueEur: Number(revenueResult?.total ?? 0) / 100,
    churnRate,
    topContacts: topContacts.map((c) => ({ name: c.name, stage: c.stage })),
    weekStart: formatDate(weekStart),
    weekEnd: formatDate(now),
  };
}

export async function checkAndSendDailySummaries(db: DB): Promise<void> {
  const creatorsWithDaily = await db.query.creators.findMany({
    where: and(eq(creators.dailySummaryEnabled, true)),
    columns: { id: true, email: true },
  });

  for (const creator of creatorsWithDaily) {
    try {
      const data = await generateDailySummary(db, creator.id);
      await emailQueue.add(`daily-${creator.id}`, {
        type: "daily_summary",
        to: creator.email,
        data: data as unknown as Record<string, unknown>,
      });
    } catch (err) {
      log.error({ err, creatorId: creator.id }, "Failed to generate daily summary");
    }
  }

  log.info({ count: creatorsWithDaily.length }, "Daily summaries enqueued");
}

export async function checkAndSendWeeklySummaries(db: DB): Promise<void> {
  const creatorsWithWeekly = await db.query.creators.findMany({
    where: and(eq(creators.weeklySummaryEnabled, true)),
    columns: { id: true, email: true },
  });

  for (const creator of creatorsWithWeekly) {
    try {
      const data = await generateWeeklySummary(db, creator.id);
      await emailQueue.add(`weekly-${creator.id}`, {
        type: "weekly_summary",
        to: creator.email,
        data: data as unknown as Record<string, unknown>,
      });
    } catch (err) {
      log.error({ err, creatorId: creator.id }, "Failed to generate weekly summary");
    }
  }

  log.info({ count: creatorsWithWeekly.length }, "Weekly summaries enqueued");
}
