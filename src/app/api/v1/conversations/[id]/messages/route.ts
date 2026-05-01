import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db";
import { authenticateApiKey } from "@/server/api/middleware/api-key-auth";
import { messages, conversations, contacts } from "@/server/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  // Verify conversation belongs to creator
  const conversation = await db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(
      and(
        eq(conversations.id, id),
        eq(contacts.creatorId, auth.creatorId)
      )
    )
    .limit(1);

  if (conversation.length === 0) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit")) || 50));
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      sentiment: messages.sentiment,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .offset(offset);

  const [total] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .where(eq(messages.conversationId, id));

  return NextResponse.json({
    data: rows,
    pagination: {
      page,
      limit,
      total: Number(total?.count ?? 0),
    },
  });
}
