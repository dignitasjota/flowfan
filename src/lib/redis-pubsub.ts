import type Redis from "ioredis";
import { createRedisClient, LONG_LIVED_REDIS_OPTIONS } from "./redis-client";

export type RealtimeEventType =
  | "new_message"
  | "notification"
  | "conversation_update"
  | "presence_update"
  | "typing_start"
  | "typing_stop"
  | "viewing_conversation"
  | "new_comment"
  | "comment_handled";

export type RealtimeEvent = {
  type: RealtimeEventType;
  data: Record<string, unknown>;
  timestamp: number;
};

const CHANNEL_PREFIX = "fanflow:events:";

function getChannel(creatorId: string) {
  return `${CHANNEL_PREFIX}${creatorId}`;
}

// Publisher — reuses an existing connection or creates one lazily
let publisherClient: Redis | null = null;

function getPublisher(): Redis {
  if (!publisherClient) {
    publisherClient = createRedisClient({ ...LONG_LIVED_REDIS_OPTIONS, lazyConnect: true });
  }
  return publisherClient;
}

export async function publishEvent(
  creatorId: string,
  event: Omit<RealtimeEvent, "timestamp">
): Promise<void> {
  const fullEvent: RealtimeEvent = { ...event, timestamp: Date.now() };
  const client = getPublisher();
  await client.publish(getChannel(creatorId), JSON.stringify(fullEvent));
}

// Subscriber — creates a dedicated connection (Redis requires this for pub/sub)
export function subscribeToCreator(
  creatorId: string,
  callback: (event: RealtimeEvent) => void
): () => void {
  const subscriber = createRedisClient(LONG_LIVED_REDIS_OPTIONS);

  const channel = getChannel(creatorId);

  subscriber.subscribe(channel).catch(() => {
    // Connection may have been closed already
  });

  subscriber.on("message", (_ch: string, message: string) => {
    try {
      const event = JSON.parse(message) as RealtimeEvent;
      callback(event);
    } catch {
      // Ignore malformed messages
    }
  });

  return () => {
    subscriber.unsubscribe(channel).catch(() => {});
    subscriber.disconnect();
  };
}
