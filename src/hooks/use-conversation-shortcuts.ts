"use client";

import { useEffect } from "react";

type Handlers = {
  onNext?: () => void;
  onPrev?: () => void;
  onReply?: () => void;
  onArchive?: () => void;
  onShowHelp?: () => void;
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Registers global keyboard shortcuts for the conversations inbox.
 * Disabled while the user is typing in an input/textarea/contenteditable.
 *
 * Bindings:
 *  - j / ArrowDown — next conversation
 *  - k / ArrowUp   — previous conversation
 *  - r             — focus reply input
 *  - a             — archive selected conversation
 *  - ? (Shift+/)   — open shortcut cheatsheet
 */
export function useConversationShortcuts(handlers: Handlers, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      switch (e.key) {
        case "j":
        case "ArrowDown":
          if (handlers.onNext) {
            e.preventDefault();
            handlers.onNext();
          }
          break;
        case "k":
        case "ArrowUp":
          if (handlers.onPrev) {
            e.preventDefault();
            handlers.onPrev();
          }
          break;
        case "r":
          if (handlers.onReply) {
            e.preventDefault();
            handlers.onReply();
          }
          break;
        case "a":
          if (handlers.onArchive) {
            e.preventDefault();
            handlers.onArchive();
          }
          break;
        case "?":
          if (handlers.onShowHelp) {
            e.preventDefault();
            handlers.onShowHelp();
          }
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, handlers]);
}
