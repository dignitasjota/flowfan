import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db";
import { authenticateApiKey } from "@/server/api/middleware/api-key-auth";
import { contacts, contactProfiles } from "@/server/db/schema";
import { eq, and, ilike, sql, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50));
  const search = searchParams.get("search");
  const platform = searchParams.get("platform");
  const funnelStage = searchParams.get("funnel_stage");

  const conditions = [eq(contacts.creatorId, auth.creatorId)];
  if (search) conditions.push(ilike(contacts.username, `%${search}%`));
  if (platform) conditions.push(eq(contacts.platformType, platform as any));

  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      id: contacts.id,
      username: contacts.username,
      displayName: contacts.displayName,
      platformType: contacts.platformType,
      isArchived: contacts.isArchived,
      tags: contacts.tags,
      firstInteractionAt: contacts.firstInteractionAt,
      lastInteractionAt: contacts.lastInteractionAt,
      totalConversations: contacts.totalConversations,
      engagementLevel: contactProfiles.engagementLevel,
      paymentProbability: contactProfiles.paymentProbability,
      funnelStage: contactProfiles.funnelStage,
      estimatedBudget: contactProfiles.estimatedBudget,
    })
    .from(contacts)
    .leftJoin(contactProfiles, eq(contacts.id, contactProfiles.contactId))
    .where(and(...conditions))
    .orderBy(desc(contacts.lastInteractionAt))
    .limit(limit)
    .offset(offset);

  // Filter by funnel stage after join (if specified)
  const filtered = funnelStage
    ? rows.filter((r) => r.funnelStage === funnelStage)
    : rows;

  const [total] = await db
    .select({ count: sql<number>`count(*)` })
    .from(contacts)
    .where(and(...conditions));

  return NextResponse.json({
    data: filtered,
    pagination: {
      page,
      limit,
      total: Number(total?.count ?? 0),
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  if (auth.accessLevel !== "full") {
    return NextResponse.json(
      { error: "Write access requires Business plan" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { username, displayName, platformType, tags } = body;

  if (!username || !platformType) {
    return NextResponse.json(
      { error: "username and platformType are required" },
      { status: 400 }
    );
  }

  const [created] = await db
    .insert(contacts)
    .values({
      creatorId: auth.creatorId,
      username,
      displayName: displayName ?? null,
      platformType,
      tags: tags ?? [],
    })
    .returning();

  // Create empty profile
  await db.insert(contactProfiles).values({
    contactId: created.id,
  });

  return NextResponse.json({ data: created }, { status: 201 });
}
