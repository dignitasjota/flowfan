"use client";

import { useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";

export function useTyping(conversationId: string | null) {
  const startTyping = trpc.presence.startTyping.useMutation();
  const stopTyping = trpc.presence.stopTyping.useMutation();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const onKeyPress = useCallback(() => {
    if (!conversationId) return;

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      startTyping.mutate({ conversationId });
    }

    // Reset auto-stop timer
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      stopTyping.mutate({ conversationId });
    }, 3000);
  }, [conversationId]);

  const stop = useCallback(() => {
    if (!conversationId) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      stopTyping.mutate({ conversationId });
    }
  }, [conversationId]);

  return { onKeyPress, stop };
}
