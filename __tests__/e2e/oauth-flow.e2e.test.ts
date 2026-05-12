import { it, expect } from "vitest";
import { eq, and, lt } from "drizzle-orm";
import { oauthPendingFlows } from "@/server/db/schema";
import { e2eDescribe, withTx, seedCreator } from "./_helpers";

e2eDescribe("E2E oauth-flow", () => {
  it("state column enforces uniqueness", async () => {
    await withTx(async (tx) => {
      const creator = await seedCreator(tx);
      const state = "duplicate-state-token";

      await tx.insert(oauthPendingFlows).values({
        state,
        creatorId: creator.id,
        provider: "twitter",
        codeVerifier: "verifier-1",
        expiresAt: new Date(Date.now() + 600_000),
      });

      let dupError: Error | null = null;
      try {
        await tx.insert(oauthPendingFlows).values({
          state,
          creatorId: creator.id,
          provider: "instagram",
          expiresAt: new Date(Date.now() + 600_000),
        });
      } catch (err) {
        dupError = err as Error;
      }
      expect(dupError, "duplicate state must throw").not.toBeNull();
    });
  });

  it("expired flows can be filtered by expiresAt < now", async () => {
    await withTx(async (tx) => {
      const creator = await seedCreator(tx);

      await tx.insert(oauthPendingFlows).values({
        state: "fresh-state",
        creatorId: creator.id,
        provider: "twitter",
        expiresAt: new Date(Date.now() + 600_000),
      });

      await tx.insert(oauthPendingFlows).values({
        state: "stale-state",
        creatorId: creator.id,
        provider: "twitter",
        expiresAt: new Date(Date.now() - 10_000),
      });

      const expired = await tx.query.oauthPendingFlows.findMany({
        where: and(
          eq(oauthPendingFlows.creatorId, creator.id),
          lt(oauthPendingFlows.expiresAt, new Date())
        ),
      });

      expect(expired).toHaveLength(1);
      expect(expired[0]?.state).toBe("stale-state");
    });
  });
});
