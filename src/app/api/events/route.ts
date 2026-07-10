import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import { subscribeToCreator } from "@/lib/redis-pubsub";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const creatorId = session.user.activeCreatorId ?? session.user.id;

  // FE-1: la limpieza (unsubscribe + clearInterval) debe ejecutarse cuando el
  // cliente se desconecta. Se declara fuera del ReadableStream para poder
  // invocarla desde cancel(), req.signal y los catch de enqueue.
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (heartbeat) clearInterval(heartbeat);
    if (unsubscribe) unsubscribe();
  };

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial connection event
      controller.enqueue(encoder.encode("data: {\"type\":\"connected\"}\n\n"));

      // Heartbeat every 30s to keep connection alive
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          cleanup();
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }
      }, 30000);

      // Subscribe to Redis events for this creator
      unsubscribe = subscribeToCreator(creatorId, (event) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          // Stream closed → free the dedicated Redis connection
          cleanup();
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }
      });

      // Client disconnect: the request's AbortSignal fires reliably here.
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
    // Called by the runtime when the client disconnects / the stream is cancelled.
    cancel() {
      cleanup();
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
