"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import type { RealtimeEvent } from "@/lib/redis-pubsub";

type RealtimeContextValue = {
  /** Conversation IDs with unread new messages */
  newMessageConversations: Set<string>;
  /** Mark a conversation as read (remove from set) */
  markConversationSeen: (conversationId: string) => void;
  /** SSE connection status */
  status: "connecting" | "connected" | "disconnected";
};

export const RealtimeContext = createContext<RealtimeContextValue>({
  newMessageConversations: new Set(),
  markConversationSeen: () => {},
  status: "disconnected",
});

export function useRealtimeContext() {
  return useContext(RealtimeContext);
}

export function useRealtime() {
  const { data: session, status: sessionStatus } = useSession();
  const utils = trpc.useUtils();
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("disconnected");
  const [newMessageConversations, setNewMessageConversations] = useState<
    Set<string>
  >(new Set());
  const eventSourceRef = useRef<EventSource | null>(null);
  const notificationPermissionAsked = useRef(false);

  const markConversationSeen = useCallback((conversationId: string) => {
    setNewMessageConversations((prev) => {
      const next = new Set(prev);
      next.delete(conversationId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (sessionStatus !== "authenticated" || !session?.user) return;

    // Request notification permission once
    if (
      !notificationPermissionAsked.current &&
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      notificationPermissionAsked.current = true;
      Notification.requestPermission().catch(() => {});
    }

    setConnectionStatus("connecting");

    const es = new EventSource("/api/events");
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnectionStatus("connected");
    };

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as { type: string; data: Record<string, unknown>; timestamp: number };

        if (event.type === "connected") return;

        switch (event.type) {
          case "new_message": {
            const conversationId = event.data.conversationId as string;
            const role = event.data.role as string;
            const contactName = event.data.contactName as string | undefined;

            // Invalidate queries so data refreshes
            utils.conversations.getById.invalidate({ id: conversationId });
            utils.conversations.list.invalidate();

            // Track unread conversation
            setNewMessageConversations((prev) => {
              const next = new Set(prev);
              next.add(conversationId);
              return next;
            });

            // Browser notification for fan messages when tab is hidden
            if (
              role === "fan" &&
              typeof document !== "undefined" &&
              document.hidden &&
              typeof Notification !== "undefined" &&
              Notification.permission === "granted"
            ) {
              new Notification("Nuevo mensaje", {
                body: contactName
                  ? `${contactName} te envio un mensaje`
                  : "Tienes un nuevo mensaje de un fan",
                icon: "/logo.png",
                tag: conversationId,
              });
            }
            break;
          }

          case "notification":
            utils.intelligence.getUnreadCount.invalidate();
            utils.intelligence.getNotifications.invalidate();
            break;

          case "conversation_update":
            utils.conversations.list.invalidate();
            break;
        }
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      setConnectionStatus("disconnected");
      // EventSource reconnects automatically
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
      setConnectionStatus("disconnected");
    };
  }, [sessionStatus, session?.user, utils]);

  return {
    newMessageConversations,
    markConversationSeen,
    status: connectionStatus,
  };
}
