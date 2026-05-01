import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db";
import { authenticateApiKey } from "@/server/api/middleware/api-key-auth";
import { conversations, contacts } from "@/server/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50));
  const status = searchParams.get("status") ?? "active";

  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      id: conversations.id,
      contactId: conversations.contactId,
      contactUsername: contacts.username,
      contactDisplayName: contacts.displayName,
      platformType: contacts.platformType,
      status: conversations.status,
      isPinned: conversations.isPinned,
      lastMessageAt: conversations.lastMessageAt,
      startedAt: conversations.startedAt,
    })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(
      and(
        eq(contacts.creatorId, auth.creatorId),
        eq(conversations.status, status as any)
      )
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit)
    .offset(offset);

  const [total] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(
      and(
        eq(contacts.creatorId, auth.creatorId),
        eq(conversations.status, status as any)
      )
    );

  return NextResponse.json({
    data: rows,
    pagination: {
      page,
      limit,
      total: Number(total?.count ?? 0),
    },
  });
}
