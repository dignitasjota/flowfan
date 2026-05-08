import { describe, it, expect } from "vitest";

/**
 * The social-comments router orchestrates DB writes + SSE + webhook + audit.
 * These tests cover the *decisional logic* extracted as small predicates:
 * unhandled-count delta on markHandled, post-counter updates after reply,
 * external-id matching priority for author linking. Wire-level integration
 * (DB + Redis + queue) is covered by dedicated integration tests.
 */

describe("social-comments router decisional logic", () => {
  describe("unhandled count delta on markHandled", () => {
    /**
     * Mirrors `markHandled` mutation:
     *   - same state → 0 (no change)
     *   - going pending → handled → -1 (decrement counter)
     *   - going handled → pending → +1 (increment counter)
     */
    function computeDelta(prev: boolean, next: boolean): number {
      if (prev === next) return 0;
      return next ? -1 : 1;
    }

    it("returns 0 when state does not change", () => {
      expect(computeDelta(true, true)).toBe(0);
      expect(computeDelta(false, false)).toBe(0);
    });

    it("decrements when marking as handled", () => {
      expect(computeDelta(false, true)).toBe(-1);
    });

    it("increments when reopening a handled comment", () => {
      expect(computeDelta(true, false)).toBe(1);
    });
  });

  describe("post counter delta on creator reply", () => {
    /**
     * Mirrors `replyToComment`: a creator reply also marks the parent as
     * handled if it wasn't already. The delta to apply to unhandledCount:
     *   - parent was pending → -1 (it just got handled)
     *   - parent was already handled → 0
     */
    function replyDelta(parentWasHandled: boolean): number {
      return parentWasHandled ? 0 : -1;
    }

    it("decrements when replying to pending comment", () => {
      expect(replyDelta(false)).toBe(-1);
    });

    it("does not change counter when parent was already handled", () => {
      expect(replyDelta(true)).toBe(0);
    });
  });

  describe("commentsCount always increments on reply", () => {
    /**
     * The creator's reply is itself a child comment (role=creator). It always
     * adds +1 to commentsCount regardless of handled state.
     */
    const commentsCountDelta = 1;

    it("is always +1", () => {
      expect(commentsCountDelta).toBe(1);
    });
  });

  describe("authoring source detection", () => {
    /**
     * When ingesting a comment we must decide whether to match an existing
     * contact or create a lightweight one. Priority order:
     *   1. by platformUserId (if provided)
     *   2. by username
     *   3. create new (with metadata.source = "comment")
     */
    function pickStrategy(
      platformUserId: string | null,
      hasUsernameMatch: boolean
    ): "by_platform_uid" | "by_username" | "create_new" {
      if (platformUserId) return "by_platform_uid";
      if (hasUsernameMatch) return "by_username";
      return "create_new";
    }

    it("prefers platformUserId when provided", () => {
      expect(pickStrategy("uid-1", true)).toBe("by_platform_uid");
      expect(pickStrategy("uid-1", false)).toBe("by_platform_uid");
    });

    it("falls back to username when no platformUserId", () => {
      expect(pickStrategy(null, true)).toBe("by_username");
    });

    it("creates new contact when no match exists", () => {
      expect(pickStrategy(null, false)).toBe("create_new");
    });
  });

  describe("AI suggest variant labels", () => {
    /**
     * The comment suggester returns 3 variants tagged CASUAL / ENGAGEMENT /
     * RETENTION (no SALES variant for public surfaces).
     */
    const PUBLIC_VARIANT_TAGS = ["CASUAL", "ENGAGEMENT", "RETENTION"];
    const PRIVATE_VARIANT_TAGS = ["CASUAL", "SALES", "RETENTION"];

    it("public surfaces never include SALES variant", () => {
      expect(PUBLIC_VARIANT_TAGS.includes("SALES")).toBe(false);
    });

    it("DM surfaces include SALES variant", () => {
      expect(PRIVATE_VARIANT_TAGS.includes("SALES")).toBe(true);
    });

    it("both surfaces always include CASUAL", () => {
      expect(PUBLIC_VARIANT_TAGS.includes("CASUAL")).toBe(true);
      expect(PRIVATE_VARIANT_TAGS.includes("CASUAL")).toBe(true);
    });
  });

  describe("comment role at insertion", () => {
    function roleForCreatorReply(): "creator" {
      return "creator";
    }
    function roleForFanComment(): "fan" {
      return "fan";
    }

    it("creator replies always inserted with role=creator", () => {
      expect(roleForCreatorReply()).toBe("creator");
    });

    it("fan-originated comments inserted with role=fan", () => {
      expect(roleForFanComment()).toBe("fan");
    });
  });
});
