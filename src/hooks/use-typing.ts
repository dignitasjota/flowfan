"use client";

import { useCallback, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";

export function useTyping(conversationId: string | null) {
  const startTyping = trpc.presence.startTyping.useMutation();
  const stopTyping = trpc.presence.stopTyping.useMutation();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  // FE-9: al cambiar de conversación (o desmontar), limpia el timer y resetea el
  // flag. Sin esto, si cambiabas de conversación con isTypingRef=true, el nuevo
  // onKeyPress quedaba suprimido 3s (creyendo que ya estabas "escribiendo") y el
  // stopTyping pendiente disparaba sobre la conversación anterior.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      isTypingRef.current = false;
    };
  }, [conversationId]);

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
