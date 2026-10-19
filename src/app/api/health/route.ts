import { db } from "@/server/db";
import { sql } from "drizzle-orm";
import { createRedisClient, FAIL_FAST_REDIS_OPTIONS } from "@/lib/redis-client";

export const dynamic = "force-dynamic";

// Endpoint público: en producción no se exponen mensajes internos (hosts,
// puertos, detalles del driver).
const exposeErrors = process.env.NODE_ENV !== "production";
const errMsg = (e: unknown) =>
  exposeErrors ? (e instanceof Error ? e.message : "Unknown error") : "unavailable";

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
      error: errMsg(e),
    };
  }

  // Check Redis
  const redisStart = Date.now();
  const redis = createRedisClient({ ...FAIL_FAST_REDIS_OPTIONS, connectTimeout: 3000 });
  redis.on("error", () => {});
  try {
    await redis.ping();
    checks.redis = { status: "ok", latencyMs: Date.now() - redisStart };
  } catch (e) {
    checks.redis = {
      status: "error",
      latencyMs: Date.now() - redisStart,
      error: errMsg(e),
    };
  } finally {
    // Cerrar siempre: antes un ping fallido dejaba la conexión abierta.
    redis.disconnect();
  }

  const allHealthy = Object.values(checks).every((c) => c.status === "ok");

  return Response.json(
    {
      status: allHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? "0.1.0",
      // Commit de la imagen desplegada: sirve para confirmar que un redeploy
      // (p. ej. desde Portainer) reconstruyó realmente la imagen.
      build: process.env.GIT_SHA || "unknown",
      checks,
    },
    { status: allHealthy ? 200 : 503 }
  );
}
