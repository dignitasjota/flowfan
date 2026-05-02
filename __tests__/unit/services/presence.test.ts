import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/redis", () => ({
  redis: {
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    mget: vi.fn().mockResolvedValue([]),
    scan: vi.fn().mockResolvedValue(["0", []]),
  },
}));

vi.mock("@/lib/redis-pubsub", () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
}));

import {
  setPresence,
  removePresence,
  getOnlineMembers,
  setTyping,
  clearTyping,
  setViewing,
  clearViewing,
  getViewers,
} from "@/server/services/presence";
import { publishEvent } from "@/lib/redis-pubsub";
import { redis } from "@/server/redis";

const mockRedis = vi.mocked(redis);
const mockPublish = vi.mocked(publishEvent);

describe("presence service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.scan.mockResolvedValue(["0", []]);
  });

  describe("setPresence", () => {
    it("sets Redis key with 60s TTL and publishes event", async () => {
      await setPresence("creator-1", "user-1", "online", "Test User");

      expect(mockRedis.set).toHaveBeenCalledWith(
        "fanflow:presence:creator-1:user-1",
        JSON.stringify({ status: "online", userName: "Test User" }),
        "EX",
        60
      );

      expect(mockPublish).toHaveBeenCalledWith("creator-1", {
        type: "presence_update",
        data: { userId: "user-1", status: "online", userName: "Test User" },
      });
    });
  });

  describe("removePresence", () => {
    it("deletes Redis key and publishes offline event", async () => {
      await removePresence("creator-1", "user-1");

      expect(mockRedis.del).toHaveBeenCalledWith(
        "fanflow:presence:creator-1:user-1"
      );

      expect(mockPublish).toHaveBeenCalledWith("creator-1", {
        type: "presence_update",
        data: { userId: "user-1", status: "offline" },
      });
    });
  });

  describe("getOnlineMembers", () => {
    it("returns empty array when no keys found", async () => {
      const result = await getOnlineMembers("creator-1");
      expect(result).toEqual([]);
    });

    it("returns parsed presence info from Redis", async () => {
      mockRedis.scan.mockResolvedValueOnce([
        "0",
        ["fanflow:presence:creator-1:user-1", "fanflow:presence:creator-1:user-2"],
      ]);
      mockRedis.mget.mockResolvedValueOnce([
        JSON.stringify({ status: "online", userName: "User 1" }),
        JSON.stringify({ status: "away", userName: "User 2" }),
      ]);

      const result = await getOnlineMembers("creator-1");

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        userId: "user-1",
        status: "online",
        userName: "User 1",
      });
      expect(result[1]).toEqual({
        userId: "user-2",
        status: "away",
        userName: "User 2",
      });
    });
  });

  describe("typing", () => {
    it("setTyping sets key with 5s TTL", async () => {
      await setTyping("creator-1", "conv-1", "user-1", "Test");

      expect(mockRedis.set).toHaveBeenCalledWith(
        "fanflow:typing:creator-1:conv-1:user-1",
        JSON.stringify({ userName: "Test" }),
        "EX",
        5
      );

      expect(mockPublish).toHaveBeenCalledWith("creator-1", {
        type: "typing_start",
        data: { userId: "user-1", conversationId: "conv-1", userName: "Test" },
      });
    });

    it("clearTyping deletes key and publishes stop", async () => {
      await clearTyping("creator-1", "conv-1", "user-1");

      expect(mockRedis.del).toHaveBeenCalledWith(
        "fanflow:typing:creator-1:conv-1:user-1"
      );

      expect(mockPublish).toHaveBeenCalledWith("creator-1", {
        type: "typing_stop",
        data: { userId: "user-1", conversationId: "conv-1" },
      });
    });
  });

  describe("viewing", () => {
    it("setViewing sets key with 30s TTL", async () => {
      await setViewing("creator-1", "conv-1", "user-1", "Test");

      expect(mockRedis.set).toHaveBeenCalledWith(
        "fanflow:viewing:creator-1:conv-1:user-1",
        JSON.stringify({ userName: "Test" }),
        "EX",
        30
      );

      expect(mockPublish).toHaveBeenCalledWith("creator-1", {
        type: "viewing_conversation",
        data: {
          userId: "user-1",
          conversationId: "conv-1",
          userName: "Test",
          action: "join",
        },
      });
    });

    it("clearViewing deletes key and publishes leave", async () => {
      await clearViewing("creator-1", "conv-1", "user-1");

      expect(mockRedis.del).toHaveBeenCalledWith(
        "fanflow:viewing:creator-1:conv-1:user-1"
      );
    });

    it("getViewers returns parsed viewer info", async () => {
      mockRedis.scan.mockResolvedValueOnce([
        "0",
        ["fanflow:viewing:creator-1:conv-1:user-1"],
      ]);
      mockRedis.mget.mockResolvedValueOnce([
        JSON.stringify({ userName: "User 1" }),
      ]);

      const result = await getViewers("creator-1", "conv-1");

      expect(result).toEqual([{ userId: "user-1", userName: "User 1" }]);
    });
  });
});
