import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { flattenComments } from "@/server/services/reddit-poller";

type RedditNode = {
  kind: string;
  data: {
    id?: string;
    name?: string;
    author?: string;
    body?: string;
    parent_id?: string;
    replies?: { data?: { children?: RedditNode[] } } | "";
  };
};

describe("flattenComments", () => {
  it("returns empty array when input is undefined", () => {
    expect(flattenComments(undefined)).toEqual([]);
  });

  it("flattens a single top-level comment", () => {
    const tree: RedditNode[] = [
      {
        kind: "t1",
        data: {
          id: "abc",
          name: "t1_abc",
          author: "alice",
          body: "hello",
          parent_id: "t3_post",
        },
      },
    ];
    const result = flattenComments(tree);
    expect(result).toHaveLength(1);
    expect(result[0].author).toBe("alice");
  });

  it("recursively flattens replies", () => {
    const tree: RedditNode[] = [
      {
        kind: "t1",
        data: {
          id: "a",
          name: "t1_a",
          author: "alice",
          body: "first",
          replies: {
            data: {
              children: [
                {
                  kind: "t1",
                  data: {
                    id: "b",
                    name: "t1_b",
                    author: "bob",
                    body: "reply",
                    parent_id: "t1_a",
                  },
                },
              ],
            },
          },
        },
      },
    ];
    const result = flattenComments(tree);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.author)).toEqual(["alice", "bob"]);
  });

  it("skips nodes with kind != t1 (e.g. 'more')", () => {
    const tree: RedditNode[] = [
      {
        kind: "t1",
        data: { id: "a", author: "alice", body: "kept" },
      },
      {
        kind: "more",
        data: { id: "more1" },
      },
    ];
    const result = flattenComments(tree);
    expect(result).toHaveLength(1);
    expect(result[0].author).toBe("alice");
  });

  it("skips deleted authors", () => {
    const tree: RedditNode[] = [
      {
        kind: "t1",
        data: { id: "a", author: "[deleted]", body: "ignored" },
      },
      {
        kind: "t1",
        data: { id: "b", author: "alice", body: "kept" },
      },
    ];
    const result = flattenComments(tree);
    expect(result).toHaveLength(1);
    expect(result[0].author).toBe("alice");
  });

  it("skips nodes without body", () => {
    const tree: RedditNode[] = [
      {
        kind: "t1",
        data: { id: "a", author: "alice" }, // no body
      },
      {
        kind: "t1",
        data: { id: "b", author: "alice", body: "ok" },
      },
    ];
    const result = flattenComments(tree);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b");
  });

  it("handles empty replies (Reddit sends '' when no nested children)", () => {
    const tree: RedditNode[] = [
      {
        kind: "t1",
        data: {
          id: "a",
          author: "alice",
          body: "hi",
          replies: "",
        },
      },
    ];
    const result = flattenComments(tree);
    expect(result).toHaveLength(1);
  });

  it("handles deeply nested threads", () => {
    const buildNested = (depth: number): RedditNode[] => {
      let node: RedditNode = {
        kind: "t1",
        data: { id: `lvl${depth}`, author: `u${depth}`, body: `c${depth}` },
      };
      for (let i = depth - 1; i >= 0; i--) {
        node = {
          kind: "t1",
          data: {
            id: `lvl${i}`,
            author: `u${i}`,
            body: `c${i}`,
            replies: { data: { children: [node] } },
          },
        };
      }
      return [node];
    };
    const result = flattenComments(buildNested(5));
    expect(result).toHaveLength(6);
  });
});
