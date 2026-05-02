import { redis } from "@/server/redis";
import { publishEvent } from "@/lib/redis-pubsub";

const PRESENCE_PREFIX = "fanflow:presence:";
const TYPING_PREFIX = "fanflow:typing:";
const VIEWING_PREFIX = "fanflow:viewing:";

const PRESENCE_TTL = 60; // seconds
const TYPING_TTL = 5;
const VIEWING_TTL = 30;

export type PresenceStatus = "online" | "away" | "offline";

export type PresenceInfo = {
  userId: string;
  userName: string;
  status: PresenceStatus;
};

export type ViewerInfo = {
  userId: string;
  userName: string;
};

// --- Presence ---

export async function setPresence(
  creatorId: string,
  userId: string,
  status: "online" | "away",
  userName: string
): Promise<void> {
  const key = `${PRESENCE_PREFIX}${creatorId}:${userId}`;
  await redis.set(key, JSON.stringify({ status, userName }), "EX", PRESENCE_TTL);

  publishEvent(creatorId, {
    type: "presence_update",
    data: { userId, status, userName },
  }).catch(() => {});
}

export async function removePresence(
  creatorId: string,
  userId: string
): Promise<void> {
  const key = `${PRESENCE_PREFIX}${creatorId}:${userId}`;
  await redis.del(key);

  publishEvent(creatorId, {
    type: "presence_update",
    data: { userId, status: "offline" },
  }).catch(() => {});
}

export async function getOnlineMembers(
  creatorId: string
): Promise<PresenceInfo[]> {
  const pattern = `${PRESENCE_PREFIX}${creatorId}:*`;
  const keys = await scanKeys(pattern);
  if (keys.length === 0) return [];

  const values = await redis.mget(...keys);
  const members: PresenceInfo[] = [];

  for (let i = 0; i < keys.length; i++) {
    const val = values[i];
    if (!val) continue;
    try {
      const data = JSON.parse(val) as { status: PresenceStatus; userName: string };
      const userId = keys[i]!.split(":").pop()!;
      members.push({ userId, ...data });
    } catch {
      // skip malformed
    }
  }

  return members;
}

// --- Typing ---

export async function setTyping(
  creatorId: string,
  conversationId: string,
  userId: string,
  userName: string
): Promise<void> {
  const key = `${TYPING_PREFIX}${creatorId}:${conversationId}:${userId}`;
  await redis.set(key, JSON.stringify({ userName }), "EX", TYPING_TTL);

  publishEvent(creatorId, {
    type: "typing_start",
    data: { userId, conversationId, userName },
  }).catch(() => {});
}

export async function clearTyping(
  creatorId: string,
  conversationId: string,
  userId: string
): Promise<void> {
  const key = `${TYPING_PREFIX}${creatorId}:${conversationId}:${userId}`;
  await redis.del(key);

  publishEvent(creatorId, {
    type: "typing_stop",
    data: { userId, conversationId },
  }).catch(() => {});
}

// --- Viewing ---

export async function setViewing(
  creatorId: string,
  conversationId: string,
  userId: string,
  userName: string
): Promise<void> {
  const key = `${VIEWING_PREFIX}${creatorId}:${conversationId}:${userId}`;
  await redis.set(key, JSON.stringify({ userName }), "EX", VIEWING_TTL);

  publishEvent(creatorId, {
    type: "viewing_conversation",
    data: { userId, conversationId, userName, action: "join" },
  }).catch(() => {});
}

export async function clearViewing(
  creatorId: string,
  conversationId: string,
  userId: string
): Promise<void> {
  const key = `${VIEWING_PREFIX}${creatorId}:${conversationId}:${userId}`;
  await redis.del(key);

  publishEvent(creatorId, {
    type: "viewing_conversation",
    data: { userId, conversationId, action: "leave" },
  }).catch(() => {});
}

export async function getViewers(
  creatorId: string,
  conversationId: string
): Promise<ViewerInfo[]> {
  const pattern = `${VIEWING_PREFIX}${creatorId}:${conversationId}:*`;
  const keys = await scanKeys(pattern);
  if (keys.length === 0) return [];

  const values = await redis.mget(...keys);
  const viewers: ViewerInfo[] = [];

  for (let i = 0; i < keys.length; i++) {
    const val = values[i];
    if (!val) continue;
    try {
      const data = JSON.parse(val) as { userName: string };
      const userId = keys[i]!.split(":").pop()!;
      viewers.push({ userId, userName: data.userName });
    } catch {
      // skip malformed
    }
  }

  return viewers;
}

// --- Helpers ---

async function scanKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [nextCursor, found] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = nextCursor;
    keys.push(...found);
  } while (cursor !== "0");
  return keys;
}
