import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db";
import { authenticateApiKey } from "@/server/api/middleware/api-key-auth";
import { contacts, contactProfiles } from "@/server/db/schema";
import { eq, and, ilike, or, count, desc } from "drizzle-orm";
import { platformTypeSchema, funnelStageSchema } from "@/lib/constants";
import { checkContactLimit } from "@/server/services/usage-limits";
import { dispatchWebhookEvent } from "@/server/services/webhook-dispatcher";
import { workflowQueue } from "@/server/queues";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().max(100).optional(),
  platform: platformTypeSchema.optional(),
  funnel_stage: funnelStageSchema.optional(),
});

const createBodySchema = z.object({
  username: z.string().trim().min(1).max(255),
  displayName: z.string().max(255).nullish(),
  platformType: platformTypeSchema,
  tags: z.array(z.string().max(100)).max(50).optional(),
});

function badRequest(error: z.ZodError) {
  return NextResponse.json(
    { error: "Invalid request", details: error.flatten().fieldErrors },
    { status: 400 }
  );
}

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const parsed = listQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!parsed.success) return badRequest(parsed.error);
  const { page, limit, search, platform, funnel_stage } = parsed.data;

  const conditions = [eq(contacts.creatorId, auth.creatorId)];
  if (search) {
    conditions.push(
      or(ilike(contacts.username, `%${search}%`), ilike(contacts.displayName, `%${search}%`))!
    );
  }
  if (platform) conditions.push(eq(contacts.platformType, platform));
  // En SQL (antes se filtraba en memoria tras paginar: páginas incompletas y
  // `total` que no coincidía con los resultados).
  if (funnel_stage) conditions.push(eq(contactProfiles.funnelStage, funnel_stage));
  const where = and(...conditions);

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
    .where(where)
    .orderBy(desc(contacts.lastInteractionAt))
    .limit(limit)
    .offset((page - 1) * limit);

  const [total] = await db
    .select({ count: count() })
    .from(contacts)
    .leftJoin(contactProfiles, eq(contacts.id, contactProfiles.contactId))
    .where(where);

  return NextResponse.json({
    data: rows,
    pagination: { page, limit, total: total?.count ?? 0 },
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

  const body = await request.json().catch(() => null);
  const parsed = createBodySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);
  const { username, displayName, platformType, tags } = parsed.data;

  // Mismo límite de plan que la UI (antes la API se lo saltaba).
  try {
    await checkContactLimit(db, auth.creatorId);
  } catch (err) {
    if (err instanceof TRPCError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(contacts)
      .values({
        creatorId: auth.creatorId,
        username,
        displayName: displayName ?? null,
        platformType,
        tags: tags ?? [],
      })
      .returning();
    await tx.insert(contactProfiles).values({ contactId: row!.id });
    return row!;
  });

  workflowQueue
    .add("new_contact", {
      type: "new_contact",
      creatorId: auth.creatorId,
      contactId: created.id,
      platformType,
    })
    .catch(() => {});
  dispatchWebhookEvent(db, auth.creatorId, "contact.created", {
    contactId: created.id,
    username,
    platformType,
    source: "api",
  }).catch(() => {});

  return NextResponse.json({ data: created }, { status: 201 });
}
