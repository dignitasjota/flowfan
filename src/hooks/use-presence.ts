"use client";

import { useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";

export function usePresence() {
  const { data: session, status } = useSession();
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeat = trpc.presence.heartbeat.useMutation();

  const sendHeartbeat = useCallback(
    (presenceStatus: "online" | "away") => {
      if (status === "authenticated") {
        heartbeat.mutate({ status: presenceStatus });
      }
    },
    [status]
  );

  useEffect(() => {
    if (status !== "authenticated") return;

    // Initial heartbeat
    sendHeartbeat("online");

    // Heartbeat every 30s
    heartbeatRef.current = setInterval(() => {
      const isHidden =
        typeof document !== "undefined" && document.hidden;
      sendHeartbeat(isHidden ? "away" : "online");
    }, 30_000);

    // Visibility change handler
    const handleVisibility = () => {
      sendHeartbeat(document.hidden ? "away" : "online");
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [status, sendHeartbeat]);
}
