import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db";
import { authenticateApiKey } from "@/server/api/middleware/api-key-auth";
import { contacts, contactProfiles } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  const contact = await db.query.contacts.findFirst({
    where: and(eq(contacts.id, id), eq(contacts.creatorId, auth.creatorId)),
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const profile = await db.query.contactProfiles.findFirst({
    where: eq(contactProfiles.contactId, id),
  });

  return NextResponse.json({
    data: {
      ...contact,
      profile: profile ?? null,
    },
  });
}
