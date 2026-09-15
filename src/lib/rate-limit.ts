import type { Redis } from "ioredis";
import { randomUUID } from "crypto";
import { createRedisClient, FAIL_FAST_REDIS_OPTIONS } from "./redis-client";

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = createRedisClient(FAIL_FAST_REDIS_OPTIONS);
    redis.on("error", () => {
      // Silently handle Redis errors — rate limiting degrades gracefully
    });
  }
  return redis;
}

type RateLimitConfig = {
  /** Max requests allowed in the window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
  /**
   * SEC-5: si es true, ante un fallo de Redis se DENIEGA (fail-closed) en vez de
   * permitir. Úsalo en endpoints de auth (login/registro/reset) para que tumbar
   * Redis no elimine la protección de fuerza bruta.
   */
  failClosed?: boolean;
};

type RateLimitResult = {
  success: boolean;
  remaining: number;
  resetAt: number;
};

/**
 * Simple sliding-window rate limiter backed by Redis.
 * Falls back to allowing requests if Redis is unavailable.
 */
export async function rateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  try {
    const r = getRedis();
    const redisKey = `rate_limit:${key}`;
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - config.windowSeconds;

    // Use a pipeline for atomicity
    const pipeline = r.pipeline();
    pipeline.zremrangebyscore(redisKey, 0, windowStart);
    pipeline.zcard(redisKey);
    pipeline.zadd(redisKey, now.toString(), `${now}:${Math.random()}`);
    pipeline.expire(redisKey, config.windowSeconds);

    const results = await pipeline.exec();
    const currentCount = (results?.[1]?.[1] as number) ?? 0;

    if (currentCount >= config.limit) {
      // Remove the entry we just added since the request is denied
      const lastResults = results?.[2];
      if (lastResults) {
        await r.zremrangebyscore(redisKey, now, now);
      }
      return {
        success: false,
        remaining: 0,
        resetAt: now + config.windowSeconds,
      };
    }

    return {
      success: true,
      remaining: config.limit - currentCount - 1,
      resetAt: now + config.windowSeconds,
    };
  } catch {
    // SEC-5: fail-closed para endpoints sensibles; fail-open para el resto.
    if (config.failClosed) {
      return {
        success: false,
        remaining: 0,
        resetAt: Math.floor(Date.now() / 1000) + config.windowSeconds,
      };
    }
    return {
      success: true,
      remaining: config.limit,
      resetAt: 0,
    };
  }
}

type MonthlyCounterResult = {
  /** `false` si este intento supera el límite. */
  allowed: boolean;
  /** Conteo tras este intento. `-1` si Redis no respondió (fail-open). */
  count: number;
};

function monthBucketUTC(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function secondsUntilNextMonthUTC(): number {
  const now = new Date();
  const nextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0)
  );
  return Math.ceil((nextMonth.getTime() - now.getTime()) / 1000);
}

/**
 * ARCH-7 / AI-8: contador atómico mensual en Redis (INCR + TTL) para usarlo
 * como gate de límites de plan, en vez del patrón check-then-insert contra
 * Postgres (`SELECT count → llamada IA → INSERT log`), que bajo concurrencia
 * deja pasar más peticiones de las permitidas (todas leen el mismo count
 * antes de que ninguna inserte su fila).
 *
 * `INCR` es atómico en Redis: con N peticiones concurrentes, cada una recibe
 * un valor distinto y consecutivo, así que solo las que caen dentro del
 * límite lo pasan. No se decrementa si se supera el límite — aceptar la
 * "reserva" evita que otra petición concurrente se cuele por debajo mientras
 * esta decide si continuar; el contador expira solo al cambiar de mes.
 *
 * Fail-open ante error de Redis (igual que `rateLimit` sin `failClosed`):
 * un límite de plan es una salvaguarda de negocio, no un boundary de
 * seguridad — no tiene sentido tumbar el producto si Redis cae.
 */
export async function incrMonthlyCounter(
  key: string,
  limit: number
): Promise<MonthlyCounterResult> {
  if (limit === -1) return { allowed: true, count: 0 };
  try {
    const r = getRedis();
    const redisKey = `usage_monthly:${key}:${monthBucketUTC()}`;
    const count = await r.incr(redisKey);
    if (count === 1) {
      await r.expire(redisKey, secondsUntilNextMonthUTC());
    }
    return { allowed: count <= limit, count };
  } catch {
    return { allowed: true, count: -1 };
  }
}

/**
 * WK-8: lock distribuido simple (`SET NX PX`) para serializar una sección
 * crítica entre procesos — p.ej. el refresco de un refresh_token OAuth
 * rotativo (Twitter), donde dos procesos refrescando en paralelo con el
 * mismo refresh_token invalida la familia entera y desconecta la cuenta.
 *
 * Devuelve un token de posesión (o `null` si no se pudo adquirir / Redis
 * falló) que hay que pasar a `releaseLock` para liberarlo — evita que un
 * proceso libere el lock de otro tras expirar el suyo por TTL.
 */
export async function acquireLock(key: string, ttlMs: number): Promise<string | null> {
  try {
    const r = getRedis();
    const token = randomUUID();
    const result = await r.set(`lock:${key}`, token, "PX", ttlMs, "NX");
    return result === "OK" ? token : null;
  } catch {
    return null;
  }
}

/** Libera un lock de `acquireLock` solo si `token` sigue siendo el dueño actual. */
export async function releaseLock(key: string, token: string): Promise<void> {
  try {
    const r = getRedis();
    await r.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1,
      `lock:${key}`,
      token
    );
  } catch {
    // Best-effort: si Redis falla al liberar, el TTL lo expira igualmente.
  }
}

/** Rate limit presets */
export const RATE_LIMITS = {
  /** Auth endpoints: 5 requests per 60 seconds per IP (fail-closed, SEC-5) */
  auth: { limit: 5, windowSeconds: 60, failClosed: true },
  /** Registration: 3 requests per 300 seconds per IP (fail-closed, SEC-5) */
  register: { limit: 3, windowSeconds: 300, failClosed: true },
  /** AI mutations: 30 requests per 60 seconds per user */
  aiMutation: { limit: 30, windowSeconds: 60 },
  /** General API: 100 requests per 60 seconds per user */
  api: { limit: 100, windowSeconds: 60 },
  /** Comment ingest endpoint: 30 req/min per API key (stricter than global) */
  commentsIngest: { limit: 30, windowSeconds: 60 },
  /** Resend verification email: 3 per 10 min per user */
  resendVerification: { limit: 3, windowSeconds: 600 },
} as const;
