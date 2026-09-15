import { createRedisClient, LONG_LIVED_REDIS_OPTIONS } from "@/lib/redis-client";

export const redis = createRedisClient(LONG_LIVED_REDIS_OPTIONS);
