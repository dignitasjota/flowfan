import { Redis } from "ioredis";

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
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
