import {
  eq,
  and,
  or,
  sql,
  inArray,
  notInArray,
  gte,
  lte,
  gt,
  lt,
  ne,
  type SQL,
} from "drizzle-orm";
import {
  contacts,
  contactProfiles,
  fanTransactions,
  segmentMembers,
} from "@/server/db/schema";

type Db = typeof import("@/server/db").db;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SegmentFilter = {
  field: string;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains";
  value: unknown;
};

type EvaluateOptions = {
  filters: SegmentFilter[];
  segmentId?: string;
  segmentType?: "dynamic" | "static" | "mixed";
  limit?: number;
  offset?: number;
  countOnly?: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts relative date strings ("7_days_ago", "30_days_ago") or a raw
 * number (days ago) into a concrete Date.
 */
export function resolveRelativeDate(value: unknown): Date {
  if (value instanceof Date) return value;

  if (typeof value === "number") {
    const d = new Date();
    d.setDate(d.getDate() - value);
    return d;
  }

  if (typeof value === "string") {
    // Pattern: "<N>_days_ago"
    const match = value.match(/^(\d+)_days_ago$/);
    if (match) {
      const days = parseInt(match[1]!, 10);
      const d = new Date();
      d.setDate(d.getDate() - days);
      return d;
    }
    // Try parsing as ISO / date string
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  throw new Error(`Cannot resolve relative date from value: ${String(value)}`);
}

/**
 * Returns true when at least one filter targets a revenue-aggregated field.
 */
export function needsRevenueJoin(filters: SegmentFilter[]): boolean {
  return filters.some(
    (f) => f.field === "totalRevenue" || f.field === "transactionCount",
  );
}

// ---------------------------------------------------------------------------
// Field → column mapping helpers
// ---------------------------------------------------------------------------

const CONTACT_FIELDS = new Set([
  "platformType",
  "tags",
  "lastInteractionAt",
  "createdAt",
  "totalConversations",
  "isArchived",
]);

const PROFILE_FIELDS = new Set([
  "funnelStage",
  "engagementLevel",
  "paymentProbability",
  "estimatedBudget",
  "conversationDepth",
  "responseSpeed",
]);

const REVENUE_FIELDS = new Set(["totalRevenue", "transactionCount"]);

// ---------------------------------------------------------------------------
// Filter → SQL condition builder
// ---------------------------------------------------------------------------

function buildFilterCondition(filter: SegmentFilter, creatorId: string): SQL {
  const { field, operator, value } = filter;

  // --- Contact direct fields ---------------------------------------------------
  if (CONTACT_FIELDS.has(field)) {
    // Tags special case
    if (field === "tags" && operator === "contains") {
      return sql`${sql.raw(String(value))} = ANY(${contacts.tags})`;
    }

    // Date fields
    if (field === "lastInteractionAt" || field === "createdAt") {
      const col =
        field === "lastInteractionAt"
          ? contacts.lastInteractionAt
          : contacts.createdAt;
      const dateVal = resolveRelativeDate(value);
      switch (operator) {
        case "gte":
          return gte(col, dateVal);
        case "lte":
          return lte(col, dateVal);
        case "gt":
          return gt(col, dateVal);
        case "lt":
          return lt(col, dateVal);
        default:
          return eq(col, dateVal);
      }
    }

    // platformType (enum - use sql for type safety)
    if (field === "platformType") {
      if (operator === "in" && Array.isArray(value)) {
        return sql`${contacts.platformType} IN (${sql.join((value as string[]).map(v => sql`${v}`), sql`, `)})`;
      }
      if (operator === "neq") {
        return sql`${contacts.platformType} != ${value as string}`;
      }
      return sql`${contacts.platformType} = ${value as string}`;
    }

    // totalConversations
    if (field === "totalConversations") {
      const num = Number(value);
      switch (operator) {
        case "gt":
          return gt(contacts.totalConversations, num);
        case "gte":
          return gte(contacts.totalConversations, num);
        case "lt":
          return lt(contacts.totalConversations, num);
        case "lte":
          return lte(contacts.totalConversations, num);
        case "neq":
          return ne(contacts.totalConversations, num);
        default:
          return eq(contacts.totalConversations, num);
      }
    }

    // isArchived
    if (field === "isArchived") {
      return eq(contacts.isArchived, Boolean(value));
    }
  }

  // --- Profile fields ----------------------------------------------------------
  if (PROFILE_FIELDS.has(field)) {
    const colMap: Record<string, typeof contactProfiles.funnelStage | typeof contactProfiles.engagementLevel | typeof contactProfiles.paymentProbability | typeof contactProfiles.estimatedBudget | typeof contactProfiles.conversationDepth | typeof contactProfiles.responseSpeed> = {
      funnelStage: contactProfiles.funnelStage,
      engagementLevel: contactProfiles.engagementLevel,
      paymentProbability: contactProfiles.paymentProbability,
      estimatedBudget: contactProfiles.estimatedBudget,
      conversationDepth: contactProfiles.conversationDepth,
      responseSpeed: contactProfiles.responseSpeed,
    };

    const col = colMap[field]!;

    // Numeric profile fields
    if (field === "engagementLevel" || field === "paymentProbability") {
      const num = Number(value);
      switch (operator) {
        case "gt":
          return gt(col, num);
        case "gte":
          return gte(col, num);
        case "lt":
          return lt(col, num);
        case "lte":
          return lte(col, num);
        case "neq":
          return ne(col, num);
        default:
          return eq(col, num);
      }
    }

    // Enum profile fields (use sql for pgEnum type compatibility)
    if (operator === "in" && Array.isArray(value)) {
      return sql`${col} IN (${sql.join((value as string[]).map(v => sql`${v}`), sql`, `)})`;
    }
    if (operator === "neq") {
      return sql`${col} != ${value as string}`;
    }
    return sql`${col} = ${value as string}`;
  }

  // --- Revenue aggregated fields -----------------------------------------------
  if (REVENUE_FIELDS.has(field)) {
    const colExpr =
      field === "totalRevenue"
        ? sql`COALESCE(rev.total_revenue, 0)`
        : sql`COALESCE(rev.tx_count, 0)`;
    const num = Number(value);

    switch (operator) {
      case "gt":
        return sql`${colExpr} > ${num}`;
      case "gte":
        return sql`${colExpr} >= ${num}`;
      case "lt":
        return sql`${colExpr} < ${num}`;
      case "lte":
        return sql`${colExpr} <= ${num}`;
      case "neq":
        return sql`${colExpr} != ${num}`;
      default:
        return sql`${colExpr} = ${num}`;
    }
  }

  throw new Error(`Unknown segment filter field: ${field}`);
}

// ---------------------------------------------------------------------------
// Main evaluator
// ---------------------------------------------------------------------------

export async function evaluateSegment(
  db: Db,
  creatorId: string,
  options: EvaluateOptions,
): Promise<{ contactIds: string[]; total: number }> {
  const {
    filters,
    segmentId,
    segmentType,
    limit,
    offset,
    countOnly = false,
  } = options;

  // ---- Static segments: simply query segment_members -----------------------
  if (segmentType === "static" && segmentId) {
    const baseWhere = and(
      eq(segmentMembers.segmentId, segmentId),
      eq(segmentMembers.membershipType, "included"),
    )!;

    if (countOnly) {
      const [row] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(segmentMembers)
        .innerJoin(contacts, eq(contacts.id, segmentMembers.contactId))
        .where(and(baseWhere, eq(contacts.creatorId, creatorId), eq(contacts.isArchived, false)));

      return { contactIds: [], total: row?.total ?? 0 };
    }

    const query = db
      .select({ contactId: segmentMembers.contactId })
      .from(segmentMembers)
      .innerJoin(contacts, eq(contacts.id, segmentMembers.contactId))
      .where(and(baseWhere, eq(contacts.creatorId, creatorId), eq(contacts.isArchived, false)))
      .$dynamic();

    if (limit) query.limit(limit);
    if (offset) query.offset(offset);

    const rows = await query;
    const contactIds = rows.map((r) => r.contactId);

    // Get total count
    const [countRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(segmentMembers)
      .innerJoin(contacts, eq(contacts.id, segmentMembers.contactId))
      .where(and(baseWhere, eq(contacts.creatorId, creatorId), eq(contacts.isArchived, false)));

    return { contactIds, total: countRow?.total ?? 0 };
  }

  // ---- Dynamic / Mixed: build dynamic query ---------------------------------

  const withRevenue = needsRevenueJoin(filters);

  // Build WHERE conditions
  const conditions: SQL[] = [
    eq(contacts.creatorId, creatorId),
    eq(contacts.isArchived, false),
  ];

  for (const filter of filters) {
    conditions.push(buildFilterCondition(filter, creatorId));
  }

  // For mixed segments, exclude manually excluded members
  if (segmentType === "mixed" && segmentId) {
    conditions.push(
      notInArray(
        contacts.id,
        sql`(SELECT ${segmentMembers.contactId} FROM ${segmentMembers} WHERE ${segmentMembers.segmentId} = ${segmentId} AND ${segmentMembers.membershipType} = 'excluded')`,
      ),
    );
  }

  const whereClause = and(...conditions)!;

  // Build the FROM + JOINs as a raw SQL fragment when revenue join is needed
  if (withRevenue) {
    // Use raw SQL for the full query when we need the revenue subquery
    const revenueSubquery = sql`
      LEFT JOIN (
        SELECT
          ${fanTransactions.contactId} AS contact_id,
          SUM(${fanTransactions.amount}) AS total_revenue,
          COUNT(*)::int AS tx_count
        FROM ${fanTransactions}
        WHERE ${fanTransactions.creatorId} = ${creatorId}
        GROUP BY ${fanTransactions.contactId}
      ) AS rev ON rev.contact_id = ${contacts.id}
    `;

    if (countOnly) {
      const [row] = await db.execute<{ total: number }>(sql`
        SELECT count(*)::int AS total
        FROM ${contacts}
        LEFT JOIN ${contactProfiles} ON ${contactProfiles.contactId} = ${contacts.id}
        ${revenueSubquery}
        WHERE ${whereClause}
        ${segmentType === "mixed" && segmentId
          ? sql`OR ${contacts.id} IN (SELECT ${segmentMembers.contactId} FROM ${segmentMembers} WHERE ${segmentMembers.segmentId} = ${segmentId} AND ${segmentMembers.membershipType} = 'included')`
          : sql``
        }
      `);
      return { contactIds: [], total: (row as unknown as { total: number })?.total ?? 0 };
    }

    // Full query with revenue join
    const mainRows = await db.execute<{ id: string }>(sql`
      SELECT ${contacts.id} AS id
      FROM ${contacts}
      LEFT JOIN ${contactProfiles} ON ${contactProfiles.contactId} = ${contacts.id}
      ${revenueSubquery}
      WHERE ${whereClause}
      ${segmentType === "mixed" && segmentId
        ? sql`OR ${contacts.id} IN (SELECT ${segmentMembers.contactId} FROM ${segmentMembers} WHERE ${segmentMembers.segmentId} = ${segmentId} AND ${segmentMembers.membershipType} = 'included')`
        : sql``
      }
      ORDER BY ${contacts.lastInteractionAt} DESC
      ${limit ? sql`LIMIT ${limit}` : sql``}
      ${offset ? sql`OFFSET ${offset}` : sql``}
    `);

    const contactIds = (mainRows as unknown as { id: string }[]).map((r) => r.id);

    // Total count
    const [countRow] = await db.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total
      FROM ${contacts}
      LEFT JOIN ${contactProfiles} ON ${contactProfiles.contactId} = ${contacts.id}
      ${revenueSubquery}
      WHERE ${whereClause}
      ${segmentType === "mixed" && segmentId
        ? sql`OR ${contacts.id} IN (SELECT ${segmentMembers.contactId} FROM ${segmentMembers} WHERE ${segmentMembers.segmentId} = ${segmentId} AND ${segmentMembers.membershipType} = 'included')`
        : sql``
      }
    `);

    return { contactIds, total: (countRow as unknown as { total: number })?.total ?? 0 };
  }

  // ---- No revenue join needed: use Drizzle query builder --------------------

  // Mixed: include manually added members via OR
  const mixedIncludeCondition =
    segmentType === "mixed" && segmentId
      ? or(
          whereClause,
          inArray(
            contacts.id,
            sql`(SELECT ${segmentMembers.contactId} FROM ${segmentMembers} WHERE ${segmentMembers.segmentId} = ${segmentId} AND ${segmentMembers.membershipType} = 'included')`,
          ),
        )
      : whereClause;

  if (countOnly) {
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(contacts)
      .leftJoin(contactProfiles, eq(contactProfiles.contactId, contacts.id))
      .where(mixedIncludeCondition);

    return { contactIds: [], total: row?.total ?? 0 };
  }

  const query = db
    .select({ id: contacts.id })
    .from(contacts)
    .leftJoin(contactProfiles, eq(contactProfiles.contactId, contacts.id))
    .where(mixedIncludeCondition)
    .orderBy(contacts.lastInteractionAt)
    .$dynamic();

  if (limit) query.limit(limit);
  if (offset) query.offset(offset);

  const rows = await query;
  const contactIds = rows.map((r) => r.id);

  // Total count
  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(contacts)
    .leftJoin(contactProfiles, eq(contactProfiles.contactId, contacts.id))
    .where(mixedIncludeCondition);

  return { contactIds, total: countRow?.total ?? 0 };
}
