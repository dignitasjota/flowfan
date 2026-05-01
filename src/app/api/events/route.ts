import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import { subscribeToCreator } from "@/lib/redis-pubsub";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const creatorId = session.user.activeCreatorId ?? session.user.id;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial connection event
      controller.enqueue(encoder.encode("data: {\"type\":\"connected\"}\n\n"));

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      // Subscribe to Redis events for this creator
      const unsubscribe = subscribeToCreator(creatorId, (event) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          // Stream closed
          unsubscribe();
          clearInterval(heartbeat);
        }
      });

      // Cleanup when client disconnects
      const cleanup = () => {
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      // AbortSignal not available in all Next.js contexts,
      // but the ReadableStream cancel callback handles it
      (controller as unknown as { signal?: AbortSignal }).signal?.addEventListener(
        "abort",
        cleanup
      );
    },
    cancel() {
      // Called when the client disconnects
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
