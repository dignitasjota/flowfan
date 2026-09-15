import { describe, it, expect, vi, beforeEach } from "vitest";

const incrMock = vi.fn();
const expireMock = vi.fn().mockResolvedValue(1);

vi.mock("ioredis", () => {
  const RedisMock = vi.fn().mockImplementation(function RedisMock() {
    return {
      incr: incrMock,
      expire: expireMock,
      pipeline: vi.fn(),
      on: vi.fn().mockReturnThis(),
    };
  });
  return { default: RedisMock, Redis: RedisMock };
});

describe("incrMonthlyCounter", () => {
  beforeEach(() => {
    vi.resetModules();
    incrMock.mockReset();
    expireMock.mockClear();
  });

  it("allows without touching Redis when limit is unlimited (-1)", async () => {
    const { incrMonthlyCounter } = await import("@/lib/rate-limit");
    const result = await incrMonthlyCounter("creator1:ai_messages", -1);
    expect(result).toEqual({ allowed: true, count: 0 });
    expect(incrMock).not.toHaveBeenCalled();
  });

  it("allows and sets TTL on the first increment of the month", async () => {
    incrMock.mockResolvedValue(1);
    const { incrMonthlyCounter } = await import("@/lib/rate-limit");
    const result = await incrMonthlyCounter("creator1:ai_messages", 20);
    expect(result).toEqual({ allowed: true, count: 1 });
    expect(expireMock).toHaveBeenCalledTimes(1);
  });

  it("does not re-set TTL on subsequent increments", async () => {
    incrMock.mockResolvedValue(5);
    const { incrMonthlyCounter } = await import("@/lib/rate-limit");
    await incrMonthlyCounter("creator1:ai_messages", 20);
    expect(expireMock).not.toHaveBeenCalled();
  });

  it("denies once the count exceeds the limit", async () => {
    incrMock.mockResolvedValue(21);
    const { incrMonthlyCounter } = await import("@/lib/rate-limit");
    const result = await incrMonthlyCounter("creator1:ai_messages", 20);
    expect(result).toEqual({ allowed: false, count: 21 });
  });

  it("allows the request that lands exactly on the limit", async () => {
    incrMock.mockResolvedValue(20);
    const { incrMonthlyCounter } = await import("@/lib/rate-limit");
    const result = await incrMonthlyCounter("creator1:ai_messages", 20);
    expect(result.allowed).toBe(true);
  });

  it("fails open when Redis errors", async () => {
    incrMock.mockRejectedValue(new Error("connection refused"));
    const { incrMonthlyCounter } = await import("@/lib/rate-limit");
    const result = await incrMonthlyCounter("creator1:ai_messages", 20);
    expect(result).toEqual({ allowed: true, count: -1 });
  });
});
