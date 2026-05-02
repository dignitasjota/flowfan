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

type PresenceInfo = {
  userId: string;
  userName: string;
  status: "online" | "away" | "offline";
};

type TypingInfo = {
  userId: string;
  userName: string;
};

type ViewerInfo = {
  userId: string;
  userName: string;
};

type RealtimeContextValue = {
  /** Conversation IDs with unread new messages */
  newMessageConversations: Set<string>;
  /** Mark a conversation as read (remove from set) */
  markConversationSeen: (conversationId: string) => void;
  /** SSE connection status */
  status: "connecting" | "connected" | "disconnected";
  /** Online team members */
  onlineMembers: Map<string, PresenceInfo>;
  /** Typing users per conversation */
  typingUsers: Map<string, TypingInfo[]>;
  /** Viewers per conversation */
  conversationViewers: Map<string, ViewerInfo[]>;
};

export const RealtimeContext = createContext<RealtimeContextValue>({
  newMessageConversations: new Set(),
  markConversationSeen: () => {},
  status: "disconnected",
  onlineMembers: new Map(),
  typingUsers: new Map(),
  conversationViewers: new Map(),
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
  const [onlineMembers, setOnlineMembers] = useState<Map<string, PresenceInfo>>(
    new Map()
  );
  const [typingUsers, setTypingUsers] = useState<Map<string, TypingInfo[]>>(
    new Map()
  );
  const [conversationViewers, setConversationViewers] = useState<
    Map<string, ViewerInfo[]>
  >(new Map());
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
        const event = JSON.parse(e.data) as {
          type: string;
          data: Record<string, unknown>;
          timestamp: number;
        };

        if (event.type === "connected") return;

        switch (event.type) {
          case "new_message": {
            const conversationId = event.data.conversationId as string;
            const role = event.data.role as string;
            const contactName = event.data.contactName as string | undefined;

            utils.conversations.getById.invalidate({ id: conversationId });
            utils.conversations.list.invalidate();

            setNewMessageConversations((prev) => {
              const next = new Set(prev);
              next.add(conversationId);
              return next;
            });

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

          case "presence_update": {
            const userId = event.data.userId as string;
            const presenceStatus = event.data.status as
              | "online"
              | "away"
              | "offline";
            const userName = (event.data.userName as string) ?? "";

            setOnlineMembers((prev) => {
              const next = new Map(prev);
              if (presenceStatus === "offline") {
                next.delete(userId);
              } else {
                next.set(userId, { userId, userName, status: presenceStatus });
              }
              return next;
            });
            break;
          }

          case "typing_start": {
            const userId = event.data.userId as string;
            const conversationId = event.data.conversationId as string;
            const userName = (event.data.userName as string) ?? "";

            setTypingUsers((prev) => {
              const next = new Map(prev);
              const current = next.get(conversationId) ?? [];
              if (!current.some((t) => t.userId === userId)) {
                next.set(conversationId, [...current, { userId, userName }]);
              }
              return next;
            });
            break;
          }

          case "typing_stop": {
            const userId = event.data.userId as string;
            const conversationId = event.data.conversationId as string;

            setTypingUsers((prev) => {
              const next = new Map(prev);
              const current = next.get(conversationId) ?? [];
              const filtered = current.filter((t) => t.userId !== userId);
              if (filtered.length === 0) {
                next.delete(conversationId);
              } else {
                next.set(conversationId, filtered);
              }
              return next;
            });
            break;
          }

          case "viewing_conversation": {
            const userId = event.data.userId as string;
            const conversationId = event.data.conversationId as string;
            const userName = (event.data.userName as string) ?? "";
            const action = event.data.action as "join" | "leave";

            setConversationViewers((prev) => {
              const next = new Map(prev);
              const current = next.get(conversationId) ?? [];

              if (action === "join") {
                if (!current.some((v) => v.userId === userId)) {
                  next.set(conversationId, [
                    ...current,
                    { userId, userName },
                  ]);
                }
              } else {
                const filtered = current.filter((v) => v.userId !== userId);
                if (filtered.length === 0) {
                  next.delete(conversationId);
                } else {
                  next.set(conversationId, filtered);
                }
              }
              return next;
            });
            break;
          }
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
    onlineMembers,
    typingUsers,
    conversationViewers,
  };
}
