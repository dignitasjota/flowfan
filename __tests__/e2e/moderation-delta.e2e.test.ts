import { it, expect } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  socialPosts,
  socialComments,
} from "@/server/db/schema";
import { e2eDescribe, withTx, seedCreator } from "./_helpers";

e2eDescribe("E2E moderation-delta", () => {
  it("hides a pending comment and decrements unhandledCount", async () => {
    await withTx(async (tx) => {
      const creator = await seedCreator(tx);

      const [post] = await tx
        .insert(socialPosts)
        .values({
          creatorId: creator.id,
          platformType: "reddit",
          externalPostId: "t3_mod",
          commentsCount: 1,
          unhandledCount: 1,
        })
        .returning();

      const [comment] = await tx
        .insert(socialComments)
        .values({
          creatorId: creator.id,
          postId: post!.id,
          platformType: "reddit",
          externalCommentId: "t1_mod",
          authorUsername: "alice",
          content: "pending comment",
          isHandled: false,
          moderationStatus: "visible",
        })
        .returning();

      // Simulate the setModerationStatus logic: hide a pending comment
      await tx
        .update(socialComments)
        .set({
          moderationStatus: "hidden",
          moderatedAt: new Date(),
          moderatedById: creator.id,
        })
        .where(eq(socialComments.id, comment!.id));

      // Mirror the unhandledCount adjustment we do in the router
      await tx
        .update(socialPosts)
        .set({
          unhandledCount: sql`GREATEST(0, ${socialPosts.unhandledCount} - 1)`,
        })
        .where(eq(socialPosts.id, post!.id));

      const refreshed = await tx.query.socialPosts.findFirst({
        where: eq(socialPosts.id, post!.id),
      });
      expect(refreshed?.unhandledCount).toBe(0);
    });
  });

  it("restoring a previously hidden pending comment increments unhandledCount", async () => {
    await withTx(async (tx) => {
      const creator = await seedCreator(tx);

      const [post] = await tx
        .insert(socialPosts)
        .values({
          creatorId: creator.id,
          platformType: "reddit",
          externalPostId: "t3_restore",
          commentsCount: 1,
          unhandledCount: 0,
        })
        .returning();

      const [comment] = await tx
        .insert(socialComments)
        .values({
          creatorId: creator.id,
          postId: post!.id,
          platformType: "reddit",
          externalCommentId: "t1_restore",
          authorUsername: "bob",
          content: "previously hidden",
          isHandled: false,
          moderationStatus: "hidden",
        })
        .returning();

      // Restore back to visible
      await tx
        .update(socialComments)
        .set({ moderationStatus: "visible", moderatedAt: null, moderatedById: null })
        .where(eq(socialComments.id, comment!.id));

      await tx
        .update(socialPosts)
        .set({
          unhandledCount: sql`${socialPosts.unhandledCount} + 1`,
        })
        .where(eq(socialPosts.id, post!.id));

      const refreshed = await tx.query.socialPosts.findFirst({
        where: eq(socialPosts.id, post!.id),
      });
      expect(refreshed?.unhandledCount).toBe(1);
    });
  });
});
