import { it, expect } from "vitest";
import { eq } from "drizzle-orm";
import {
  scheduledPosts,
  socialAccounts,
} from "@/server/db/schema";
import { e2eDescribe, withTx, seedCreator } from "./_helpers";

e2eDescribe("E2E scheduler-create", () => {
  it("multi-account: same (creator, platform) is allowed with different externalAccountId", async () => {
    await withTx(async (tx) => {
      const creator = await seedCreator(tx);

      await tx.insert(socialAccounts).values({
        creatorId: creator.id,
        platformType: "twitter",
        connectionType: "native",
        accountUsername: "main",
        externalAccountId: "external-1",
      });

      // Second account on the same platform should be allowed
      await tx.insert(socialAccounts).values({
        creatorId: creator.id,
        platformType: "twitter",
        connectionType: "native",
        accountUsername: "secondary",
        externalAccountId: "external-2",
      });

      const rows = await tx.query.socialAccounts.findMany({
        where: eq(socialAccounts.creatorId, creator.id),
      });
      expect(rows).toHaveLength(2);
    });
  });

  it("rejects duplicate (creator, platform, externalAccountId)", async () => {
    await withTx(async (tx) => {
      const creator = await seedCreator(tx);

      await tx.insert(socialAccounts).values({
        creatorId: creator.id,
        platformType: "twitter",
        connectionType: "native",
        accountUsername: "main",
        externalAccountId: "external-1",
      });

      let dupError: Error | null = null;
      try {
        await tx.insert(socialAccounts).values({
          creatorId: creator.id,
          platformType: "twitter",
          connectionType: "native",
          accountUsername: "duplicate",
          externalAccountId: "external-1",
        });
      } catch (err) {
        dupError = err as Error;
      }
      expect(dupError, "same externalAccountId should be rejected").not.toBeNull();
    });
  });

  it("persists a scheduled post with platformConfigs.accountId", async () => {
    await withTx(async (tx) => {
      const creator = await seedCreator(tx);

      const [post] = await tx
        .insert(scheduledPosts)
        .values({
          creatorId: creator.id,
          content: "Test post",
          targetPlatforms: ["twitter"],
          platformConfigs: {
            twitter: {
              accountId: "00000000-0000-0000-0000-000000000001",
              tweet: "Hello world",
            },
          },
          scheduleAt: new Date(Date.now() + 3600_000),
        })
        .returning();

      expect(post).toBeDefined();
      const cfg = (post!.platformConfigs as Record<string, unknown>).twitter as
        | { accountId: string; tweet: string }
        | undefined;
      expect(cfg?.accountId).toBe("00000000-0000-0000-0000-000000000001");
      expect(cfg?.tweet).toBe("Hello world");
    });
  });
});
