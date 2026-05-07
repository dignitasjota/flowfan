import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@/server/services/webhook-dispatcher", () => ({
  dispatchWebhookEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/queues", () => ({
  analysisQueue: {
    add: vi.fn().mockResolvedValue({ id: "job-1" }),
  },
}));

import {
  linkOrCreateCommentAuthor,
  enqueueCommentAnalysis,
} from "@/server/services/social-comments-ingest";
import { analysisQueue } from "@/server/queues";
import { dispatchWebhookEvent } from "@/server/services/webhook-dispatcher";

type FakeContact = {
  id: string;
  creatorId: string;
  platformType: string;
  username: string;
  platformUserId: string | null;
};

function makeDb(contacts: FakeContact[] = []) {
  let createdContact: FakeContact | null = null;
  let insertCallCount = 0;

  const findContactFirst = vi.fn().mockImplementation(() => {
    return Promise.resolve(contacts[0] ?? null);
  });

  return {
    contacts,
    get createdContact() {
      return createdContact;
    },
    get insertCallCount() {
      return insertCallCount;
    },
    query: {
      contacts: {
        findFirst: findContactFirst,
      },
    },
    insert: vi.fn().mockImplementation(() => {
      // Call order in the helper: 1st = contacts, 2nd = contactProfiles
      insertCallCount++;
      const isContactsInsert = insertCallCount === 1;
      return {
        values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
          if (isContactsInsert) {
            const row: FakeContact = {
              id: "new-contact",
              creatorId: vals.creatorId as string,
              platformType: vals.platformType as string,
              username: vals.username as string,
              platformUserId: (vals.platformUserId as string | null) ?? null,
            };
            createdContact = row;
            return { returning: () => Promise.resolve([row]) };
          }
          // contactProfiles insert returns nothing meaningful
          return Promise.resolve(undefined);
        }),
      };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("linkOrCreateCommentAuthor", () => {
  it("matches by platformUserId first", async () => {
    const existing: FakeContact = {
      id: "existing-1",
      creatorId: "c1",
      platformType: "reddit",
      username: "rUser",
      platformUserId: "uid-1",
    };
    const db = makeDb([existing]);

    const result = await linkOrCreateCommentAuthor(
      db as never,
      "c1",
      "reddit",
      { username: "rUser", platformUserId: "uid-1" }
    );

    expect(result.contactId).toBe("existing-1");
    expect(result.created).toBe(false);
    expect(db.createdContact).toBeNull();
  });

  it("creates a contact when no match exists", async () => {
    const db = makeDb([]); // no existing contacts

    const result = await linkOrCreateCommentAuthor(
      db as never,
      "creator-x",
      "reddit",
      { username: "newFan", platformUserId: "uid-99" }
    );

    expect(result.created).toBe(true);
    expect(result.contactId).toBe("new-contact");
    // Two inserts: contacts + contactProfiles
    expect(db.insertCallCount).toBe(2);
    // Webhook fires after creating
    expect(dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      "creator-x",
      "contact.created",
      expect.objectContaining({
        username: "newFan",
        platformType: "reddit",
        source: "comment",
      })
    );
  });
});

describe("enqueueCommentAnalysis", () => {
  it("pushes a job with source=comment", () => {
    enqueueCommentAnalysis({
      creatorId: "c1",
      contactId: "ct1",
      commentId: "cm1",
      content: "great post",
      platformType: "reddit",
    });

    expect(analysisQueue.add).toHaveBeenCalledWith(
      "analyze",
      expect.objectContaining({
        creatorId: "c1",
        contactId: "ct1",
        messageId: "cm1",
        source: "comment",
        platformType: "reddit",
      })
    );
  });
});
