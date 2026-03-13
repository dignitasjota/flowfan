import { vi } from "vitest";

// Mock environment variables
process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.NEXTAUTH_SECRET = "test-secret";
process.env.NEXTAUTH_URL = "http://localhost:3000";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

// Mock Redis for rate-limit tests
vi.mock("ioredis", () => {
  const RedisMock = vi.fn().mockImplementation(() => ({
    pipeline: vi.fn().mockReturnValue({
      zremrangebyscore: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, 0],
        [null, 0],
        [null, 1],
        [null, 1],
      ]),
    }),
    zremrangebyscore: vi.fn().mockResolvedValue(0),
    quit: vi.fn().mockResolvedValue("OK"),
    ping: vi.fn().mockResolvedValue("PONG"),
    on: vi.fn().mockReturnThis(),
    connect: vi.fn().mockResolvedValue(undefined),
  }));
  return { default: RedisMock, Redis: RedisMock };
});
