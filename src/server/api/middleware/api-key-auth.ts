import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db";
import { validateApiKey } from "@/server/services/api-keys";
import { eq } from "drizzle-orm";
import { creators } from "@/server/db/schema";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("api-key-auth");

type ApiAccessLevel = "full" | "readonly";

type AuthResult = {
  creatorId: string;
  keyId: string;
  accessLevel: ApiAccessLevel;
};

const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(keyId: string, limit: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let entry = rateLimitMap.get(keyId);

  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    rateLimitMap.set(keyId, entry);
  }

  entry.count++;

  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
  };
}

export async function authenticateApiKey(
  request: NextRequest
): Promise<AuthResult | NextResponse> {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header. Use: Bearer ff_live_xxx" },
      { status: 401 }
    );
  }

  const rawKey = authHeader.slice(7);

  const result = await validateApiKey(db, rawKey);
  if (!result) {
    return NextResponse.json(
      { error: "Invalid or expired API key" },
      { status: 401 }
    );
  }

  // Check plan for access level
  const creator = await db.query.creators.findFirst({
    where: eq(creators.id, result.creatorId),
    columns: { subscriptionPlan: true },
  });

  const plan = creator?.subscriptionPlan ?? "free";

  if (plan !== "pro" && plan !== "business") {
    return NextResponse.json(
      { error: "API access requires Pro or Business plan" },
      { status: 403 }
    );
  }

  const accessLevel: ApiAccessLevel = plan === "business" ? "full" : "readonly";

  // Rate limiting
  const rateLimit = plan === "business" ? 60 : 30;
  const { allowed, remaining, resetAt } = checkRateLimit(result.keyId, rateLimit);

  if (!allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": String(rateLimit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
        },
      }
    );
  }

  // Attach rate limit headers to be used by caller
  // (we store them in a custom way since we return the auth result)
  return {
    creatorId: result.creatorId,
    keyId: result.keyId,
    accessLevel,
  };
}

export function withRateLimitHeaders(
  response: NextResponse,
  keyId: string,
  limit: number
): NextResponse {
  const entry = rateLimitMap.get(keyId);
  if (entry) {
    response.headers.set("X-RateLimit-Limit", String(limit));
    response.headers.set("X-RateLimit-Remaining", String(Math.max(0, limit - entry.count)));
    response.headers.set("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));
  }
  return response;
}
