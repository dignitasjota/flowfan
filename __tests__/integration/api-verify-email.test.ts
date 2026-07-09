import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

vi.mock("@/server/db", () => ({
  db: {
    query: {
      creators: { findFirst: vi.fn() },
    },
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

import { db } from "@/server/db";
import { GET } from "@/app/api/auth/verify-email/route";

const mockFindFirst = vi.mocked(db.query.creators.findFirst);

process.env.NEXTAUTH_URL = "http://localhost:3000";

function reqWith(token?: string): Request {
  const url = token
    ? `http://localhost:3000/api/auth/verify-email?token=${token}`
    : `http://localhost:3000/api/auth/verify-email`;
  return new Request(url);
}

function locationOf(res: Response): string {
  return res.headers.get("location") ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/auth/verify-email", () => {
  it("redirects to invalid-token when no token is provided", async () => {
    const res = await GET(reqWith());
    expect(res.status).toBe(307);
    expect(locationOf(res)).toContain("error=invalid-token");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("redirects to invalid-token when the token matches no creator", async () => {
    mockFindFirst.mockResolvedValue(undefined as never);
    const res = await GET(reqWith("does-not-exist"));
    expect(locationOf(res)).toContain("error=invalid-token");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("redirects to verified=already when the email is already verified", async () => {
    mockFindFirst.mockResolvedValue({
      id: "c1",
      emailVerified: true,
      emailVerificationExpiresAt: null,
    } as never);
    const res = await GET(reqWith("tok"));
    expect(locationOf(res)).toContain("verified=already");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("redirects to token-expired when the token is past its expiry", async () => {
    mockFindFirst.mockResolvedValue({
      id: "c1",
      emailVerified: false,
      emailVerificationExpiresAt: new Date(Date.now() - 60_000),
    } as never);
    const res = await GET(reqWith("tok"));
    expect(locationOf(res)).toContain("error=token-expired");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("verifies and redirects to verified=true when the token is valid and unexpired", async () => {
    mockFindFirst.mockResolvedValue({
      id: "c1",
      emailVerified: false,
      emailVerificationExpiresAt: new Date(Date.now() + 60_000),
    } as never);
    const res = await GET(reqWith("tok"));
    expect(locationOf(res)).toContain("verified=true");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    // El update limpia token + expiry y marca verificado.
    const setArg = mockSet.mock.calls[0][0];
    expect(setArg).toMatchObject({
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpiresAt: null,
    });
  });

  it("verifies when there is no expiry set (back-compat con tokens antiguos)", async () => {
    mockFindFirst.mockResolvedValue({
      id: "c1",
      emailVerified: false,
      emailVerificationExpiresAt: null,
    } as never);
    const res = await GET(reqWith("tok"));
    expect(locationOf(res)).toContain("verified=true");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});
