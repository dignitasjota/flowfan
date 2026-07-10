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
  // FE-3: reconexión con backoff cuando el EventSource cae a CLOSED
  // (401/HTML tras un deploy o sesión expirada) — el navegador no reconecta solo.
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      reconnectAttempt.current = 0; // reset backoff al conectar
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

          case "new_comment": {
            const postId = event.data.postId as string | undefined;
            const role = event.data.role as string | undefined;
            const authorUsername = event.data.authorUsername as string | undefined;

            utils.socialComments.listPosts.invalidate();
            utils.socialComments.overview.invalidate();
            if (postId) {
              utils.socialComments.listComments.invalidate({
                postId,
                onlyUnhandled: false,
              });
              utils.socialComments.getPost.invalidate({ id: postId });
            }

            if (
              role !== "creator" &&
              typeof document !== "undefined" &&
              document.hidden &&
              typeof Notification !== "undefined" &&
              Notification.permission === "granted"
            ) {
              new Notification("Nuevo comentario", {
                body: authorUsername
                  ? `${authorUsername} comentó en uno de tus posts`
                  : "Nuevo comentario público",
                icon: "/logo.png",
                tag: postId ?? "comments",
              });
            }
            break;
          }

          case "comment_handled": {
            const postId = event.data.postId as string | undefined;
            utils.socialComments.listPosts.invalidate();
            utils.socialComments.overview.invalidate();
            if (postId) {
              utils.socialComments.listComments.invalidate({
                postId,
                onlyUnhandled: false,
              });
              utils.socialComments.getPost.invalidate({ id: postId });
            }
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
      // El navegador reconecta solo mientras readyState es CONNECTING. Si pasa a
      // CLOSED (401/HTML), reprogramamos una reconexión con backoff exponencial
      // (cap 30s) incrementando el nonce → el efecto se re-ejecuta y recrea el ES.
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        const delay = Math.min(30_000, 1000 * 2 ** reconnectAttempt.current);
        reconnectAttempt.current += 1;
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(
          () => setReconnectNonce((n) => n + 1),
          delay
        );
      }
    };

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      es.close();
      eventSourceRef.current = null;
      setConnectionStatus("disconnected");
    };
    // FE-3: depender de session?.user?.id (no del objeto session.user, que es
    // nuevo en cada refetch de sesión y provocaba reconexiones constantes).
  }, [sessionStatus, session?.user?.id, utils, reconnectNonce]);

  return {
    newMessageConversations,
    markConversationSeen,
    status: connectionStatus,
    onlineMembers,
    typingUsers,
    conversationViewers,
  };
}
