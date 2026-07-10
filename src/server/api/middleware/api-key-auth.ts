import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db";
import { validateApiKey } from "@/server/services/api-keys";
import { eq } from "drizzle-orm";
import { creators } from "@/server/db/schema";
import { createChildLogger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";

const log = createChildLogger("api-key-auth");

type ApiAccessLevel = "full" | "readonly";

type AuthResult = {
  creatorId: string;
  keyId: string;
  accessLevel: ApiAccessLevel;
};

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

  // SEC-3: rate limiting en Redis (compartido entre réplicas, con TTL) en vez
  // de un Map por proceso que se saltaba con >1 instancia y crecía sin límite.
  const limit = plan === "business" ? 60 : 30;
  const rl = await rateLimit(`apikey:${result.keyId}`, {
    limit,
    windowSeconds: 60,
  });

  if (!rl.success) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(rl.resetAt),
          "Retry-After": String(Math.max(1, rl.resetAt - Math.floor(Date.now() / 1000))),
        },
      }
    );
  }

  return {
    creatorId: result.creatorId,
    keyId: result.keyId,
    accessLevel,
  };
}
