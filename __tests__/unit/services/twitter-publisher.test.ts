import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn((v: string) => `decrypted:${v}`),
  encrypt: vi.fn((v: string) => `encrypted:${v}`),
}));

const { refreshTwitterTokenMock, acquireLockMock, releaseLockMock } = vi.hoisted(() => ({
  refreshTwitterTokenMock: vi.fn(),
  acquireLockMock: vi.fn(),
  releaseLockMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/oauth-twitter", () => ({
  refreshTwitterToken: refreshTwitterTokenMock,
}));

vi.mock("@/lib/rate-limit", () => ({
  acquireLock: acquireLockMock,
  releaseLock: releaseLockMock,
}));

import { getFreshTwitterAccessToken } from "@/server/services/twitter-publisher";

function makeAccount(overrides: Partial<{
  id: string;
  encryptedOauthAccessToken: string | null;
  encryptedOauthRefreshToken: string | null;
  oauthExpiresAt: Date | null;
}> = {}) {
  return {
    id: "account-1",
    encryptedOauthAccessToken: "enc-access",
    encryptedOauthRefreshToken: "enc-refresh",
    oauthExpiresAt: new Date(Date.now() + 3600_000), // fresh by default
    ...overrides,
  };
}

function makeDb(findFirstResult: unknown) {
  const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  return {
    query: {
      socialAccounts: {
        findFirst: vi.fn().mockResolvedValue(findFirstResult),
      },
    },
    update: vi.fn().mockReturnValue({ set: setMock }),
    _setMock: setMock,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getFreshTwitterAccessToken (WK-8)", () => {
  it("returns the decrypted token directly, without Redis or DB, when not expiring soon", async () => {
    const account = makeAccount();
    const db = makeDb(null);

    const token = await getFreshTwitterAccessToken(db, account);

    expect(token).toBe("decrypted:enc-access");
    expect(acquireLockMock).not.toHaveBeenCalled();
    expect(db.query.socialAccounts.findFirst).not.toHaveBeenCalled();
  });

  it("acquires the lock, refreshes, and persists new tokens when expiring soon", async () => {
    const account = makeAccount({ oauthExpiresAt: new Date(Date.now() - 1000) });
    const db = makeDb(account); // re-read returns the same (still expiring) row
    acquireLockMock.mockResolvedValue("lock-token-1");
    refreshTwitterTokenMock.mockResolvedValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresInSec: 7200,
    });

    const token = await getFreshTwitterAccessToken(db, account);

    expect(token).toBe("new-access");
    expect(acquireLockMock).toHaveBeenCalledWith(`twitter_refresh:${account.id}`, expect.any(Number));
    expect(refreshTwitterTokenMock).toHaveBeenCalledWith("decrypted:enc-refresh");
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db._setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        encryptedOauthAccessToken: "encrypted:new-access",
        encryptedOauthRefreshToken: "encrypted:new-refresh",
      })
    );
    expect(releaseLockMock).toHaveBeenCalledWith(`twitter_refresh:${account.id}`, "lock-token-1");
  });

  it("does NOT call refreshTwitterToken again if the re-read row is already fresh (another process just refreshed it)", async () => {
    const staleAccount = makeAccount({ oauthExpiresAt: new Date(Date.now() - 1000) });
    const freshRow = makeAccount({
      encryptedOauthAccessToken: "enc-access-refreshed-by-other",
      oauthExpiresAt: new Date(Date.now() + 3600_000),
    });
    const db = makeDb(freshRow);
    acquireLockMock.mockResolvedValue("lock-token-2");

    const token = await getFreshTwitterAccessToken(db, staleAccount);

    expect(token).toBe("decrypted:enc-access-refreshed-by-other");
    expect(refreshTwitterTokenMock).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(releaseLockMock).toHaveBeenCalled();
  });

  it("releases the lock even if refreshTwitterToken throws", async () => {
    const account = makeAccount({ oauthExpiresAt: new Date(Date.now() - 1000) });
    const db = makeDb(account);
    acquireLockMock.mockResolvedValue("lock-token-3");
    refreshTwitterTokenMock.mockRejectedValue(new Error("Twitter API down"));

    await expect(getFreshTwitterAccessToken(db, account)).rejects.toThrow("Twitter API down");

    expect(releaseLockMock).toHaveBeenCalledWith(`twitter_refresh:${account.id}`, "lock-token-3");
  });

  it("when the lock is held by another process, polls the DB until the row is fresh instead of refreshing itself", async () => {
    const account = makeAccount({ oauthExpiresAt: new Date(Date.now() - 1000) });
    const db = makeDb(null);
    acquireLockMock.mockResolvedValue(null); // someone else holds it

    // First poll: still stale. Second poll: refreshed by the other process.
    db.query.socialAccounts.findFirst
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(makeAccount({ oauthExpiresAt: new Date(Date.now() + 3600_000) }));

    const token = await getFreshTwitterAccessToken(db, account);

    expect(token).toBe("decrypted:enc-access");
    expect(refreshTwitterTokenMock).not.toHaveBeenCalled();
    expect(releaseLockMock).not.toHaveBeenCalled(); // never acquired, nothing to release
  }, 10_000);
});
