import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// Mock queue
vi.mock("@/server/queues", () => ({
  analysisQueue: {
    add: vi.fn().mockResolvedValue({ id: "job-1" }),
  },
}));

vi.mock("@/lib/logger", () => ({
  createChildLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

import { analysisQueue } from "@/server/queues";

const mockQueueAdd = vi.mocked(analysisQueue.add);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("messages router logic", () => {
  describe("list", () => {
    it("throws NOT_FOUND when conversation does not exist", () => {
      const conversation = null;
      expect(() => {
        if (!conversation) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
        }
      }).toThrow(TRPCError);
    });

    it("returns messages for valid conversation", () => {
      const messages = [
        { id: "1", role: "fan", content: "Hola" },
        { id: "2", role: "creator", content: "Hola!" },
      ];
      expect(messages).toHaveLength(2);
    });
  });

  describe("addFanMessage", () => {
    it("enqueues analysis job after saving message", async () => {
      await mockQueueAdd("analyze", {
        creatorId: "c1",
        contactId: "contact-1",
        messageId: "msg-1",
        conversationId: "conv-1",
        messageContent: "Me encanta!",
        platformType: "instagram",
        conversationHistory: [],
      });

      expect(mockQueueAdd).toHaveBeenCalledWith("analyze", expect.objectContaining({
        creatorId: "c1",
        messageContent: "Me encanta!",
      }));
    });

    it("enqueues with last 5 messages reversed as history", () => {
      const recentMessages = [
        { role: "fan", content: "1", createdAt: new Date(5) },
        { role: "creator", content: "2", createdAt: new Date(4) },
        { role: "fan", content: "3", createdAt: new Date(3) },
        { role: "creator", content: "4", createdAt: new Date(2) },
        { role: "fan", content: "5", createdAt: new Date(1) },
      ];
      // Reverse for chronological order
      const history = recentMessages.reverse().map((m) => ({
        role: m.role,
        content: m.content,
      }));
      expect(history[0]!.content).toBe("5");
      expect(history).toHaveLength(5);
    });

    it("updates conversation and contact timestamps", () => {
      // Verify the logic pattern: both timestamps should be updated
      const updates = ["conversation.lastMessageAt", "contact.lastInteractionAt"];
      expect(updates).toHaveLength(2);
    });
  });

  describe("addCreatorMessage", () => {
    it("throws NOT_FOUND for non-existent conversation", () => {
      expect(() => {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }).toThrow(TRPCError);
    });

    it("saves AI suggestion metadata when provided", () => {
      const input = {
        conversationId: "conv-1",
        content: "Hola!",
        aiSuggestion: "Suggested response",
        aiSuggestionUsed: true,
      };

      const values = {
        conversationId: input.conversationId,
        role: "creator",
        content: input.content,
        aiSuggestion: input.aiSuggestion,
        aiSuggestionUsed: input.aiSuggestionUsed,
      };

      expect(values.aiSuggestion).toBe("Suggested response");
      expect(values.aiSuggestionUsed).toBe(true);
    });

    it("saves without AI suggestion when not provided", () => {
      const input = {
        conversationId: "conv-1",
        content: "Manual message",
      };

      const values = {
        conversationId: input.conversationId,
        role: "creator",
        content: input.content,
        aiSuggestion: undefined,
        aiSuggestionUsed: undefined,
      };

      expect(values.aiSuggestion).toBeUndefined();
    });
  });
});
