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
    // If Redis fails, allow the request (fail-open)
    return {
      success: true,
      remaining: config.limit,
      resetAt: 0,
    };
  }
}

/** Rate limit presets */
export const RATE_LIMITS = {
  /** Auth endpoints: 5 requests per 60 seconds per IP */
  auth: { limit: 5, windowSeconds: 60 },
  /** Registration: 3 requests per 300 seconds per IP */
  register: { limit: 3, windowSeconds: 300 },
  /** AI mutations: 30 requests per 60 seconds per user */
  aiMutation: { limit: 30, windowSeconds: 60 },
  /** General API: 100 requests per 60 seconds per user */
  api: { limit: 100, windowSeconds: 60 },
} as const;
