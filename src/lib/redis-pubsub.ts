import Redis from "ioredis";

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
    publisherClient = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
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
  const subscriber = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
  });

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
