import { db } from "@/server/db";
import { sql } from "drizzle-orm";
import { createRedisClient, FAIL_FAST_REDIS_OPTIONS } from "@/lib/redis-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, { status: "ok" | "error"; latencyMs?: number; error?: string }> = {};

  // Check PostgreSQL
  const dbStart = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    checks.database = { status: "ok", latencyMs: Date.now() - dbStart };
  } catch (e) {
    checks.database = {
      status: "error",
      latencyMs: Date.now() - dbStart,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }

  // Check Redis
  const redisStart = Date.now();
  try {
    const redis = createRedisClient({ ...FAIL_FAST_REDIS_OPTIONS, connectTimeout: 3000 });
    await redis.ping();
    await redis.quit();
    checks.redis = { status: "ok", latencyMs: Date.now() - redisStart };
  } catch (e) {
    checks.redis = {
      status: "error",
      latencyMs: Date.now() - redisStart,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }

  const allHealthy = Object.values(checks).every((c) => c.status === "ok");

  return Response.json(
    {
      status: allHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? "0.1.0",
      checks,
    },
    { status: allHealthy ? 200 : 503 }
  );
}
