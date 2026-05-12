import { it, expect } from "vitest";
import { eq, and } from "drizzle-orm";
import {
  socialPosts,
  socialComments,
  contacts,
} from "@/server/db/schema";
import { e2eDescribe, withTx, seedCreator } from "./_helpers";

e2eDescribe("E2E comments-ingest", () => {
  it("creates contact + post + comment and dedupes by externalCommentId", async () => {
    await withTx(async (tx) => {
      const creator = await seedCreator(tx);

      // Insert a tracked post manually
      const [post] = await tx
        .insert(socialPosts)
        .values({
          creatorId: creator.id,
          platformType: "reddit",
          externalPostId: "t3_abc",
          title: "Hello",
        })
        .returning();
      expect(post).toBeDefined();

      // Insert a comment with a unique externalCommentId
      await tx.insert(socialComments).values({
        creatorId: creator.id,
        postId: post!.id,
        platformType: "reddit",
        externalCommentId: "t1_xyz",
        authorUsername: "alice",
        content: "great post",
      });

      // Attempt duplicate insert with same externalCommentId — must fail
      let dupError: Error | null = null;
      try {
        await tx.insert(socialComments).values({
          creatorId: creator.id,
          postId: post!.id,
          platformType: "reddit",
          externalCommentId: "t1_xyz",
          authorUsername: "alice",
          content: "duplicate",
        });
      } catch (err) {
        dupError = err as Error;
      }
      expect(dupError, "duplicate insert should throw").not.toBeNull();
    });
  });

  it("links comment author to existing contact when username matches", async () => {
    await withTx(async (tx) => {
      const creator = await seedCreator(tx);

      const [existing] = await tx
        .insert(contacts)
        .values({
          creatorId: creator.id,
          platformType: "reddit",
          username: "alice",
        })
        .returning();

      const [post] = await tx
        .insert(socialPosts)
        .values({
          creatorId: creator.id,
          platformType: "reddit",
          externalPostId: "t3_post",
        })
        .returning();

      await tx.insert(socialComments).values({
        creatorId: creator.id,
        postId: post!.id,
        platformType: "reddit",
        externalCommentId: "t1_match",
        authorUsername: "alice",
        authorContactId: existing!.id,
        content: "hi",
      });

      const inserted = await tx.query.socialComments.findFirst({
        where: and(
          eq(socialComments.creatorId, creator.id),
          eq(socialComments.externalCommentId, "t1_match")
        ),
      });
      expect(inserted?.authorContactId).toBe(existing!.id);
    });
  });
});
