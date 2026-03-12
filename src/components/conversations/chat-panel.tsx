"use client";

import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type Message = {
  id: string;
  role: "fan" | "creator";
  content: string;
  aiSuggestion: string | null;
  createdAt: Date;
};

type Conversation = {
  id: string;
  platformType: string;
  contact: {
    username: string;
    displayName: string | null;
  };
  messages: Message[];
};

type Props = {
  conversation: Conversation;
  onMessageSent: () => void;
  onBack?: () => void;
  onToggleContact?: () => void;
};

export function ChatPanel({ conversation, onMessageSent, onBack, onToggleContact }: Props) {
  const [fanMessage, setFanMessage] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const suggestMutation = trpc.ai.suggest.useMutation();
  const regenerateMutation = trpc.ai.regenerate.useMutation();
  const addCreatorMessage = trpc.messages.addCreatorMessage.useMutation();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.messages, isGenerating]);

  async function handleSendFanMessage() {
    if (!fanMessage.trim()) return;

    setIsGenerating(true);
    setSuggestions([]);

    try {
      const result = await suggestMutation.mutateAsync({
        conversationId: conversation.id,
        fanMessage: fanMessage.trim(),
      });

      setSuggestions(result.suggestions);
      setFanMessage("");
      onMessageSent();
    } catch {
      // Error handled by tRPC
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleUseSuggestion(suggestion: string, index: number) {
    // Copy to clipboard
    await navigator.clipboard.writeText(suggestion);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);

    // Save as creator message
    await addCreatorMessage.mutateAsync({
      conversationId: conversation.id,
      content: suggestion,
      aiSuggestion: suggestion,
      aiSuggestionUsed: true,
    });

    setSuggestions([]);
    onMessageSent();
  }

  async function handleRegenerate() {
    setIsGenerating(true);
    setSuggestions([]);

    try {
      const result = await regenerateMutation.mutateAsync({
        conversationId: conversation.id,
      });

      setSuggestions(result.suggestions);
    } catch {
      // Error handled by tRPC
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-gray-800 px-4 py-3 lg:px-6">
        {/* Back button (mobile) */}
        {onBack && (
          <button
            onClick={onBack}
            className="rounded-lg p-1 text-gray-400 hover:text-white lg:hidden"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        <div className="flex-1">
          <h3 className="text-sm font-semibold text-white">
            {conversation.contact.displayName || conversation.contact.username}
          </h3>
          <span className="text-xs text-gray-400">
            {conversation.platformType}
          </span>
        </div>

        {/* Contact info button (mobile) */}
        {onToggleContact && (
          <button
            onClick={onToggleContact}
            className="rounded-lg p-1 text-gray-400 hover:text-white lg:hidden"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="space-y-4">
          {conversation.messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "max-w-[75%] rounded-2xl px-4 py-2.5",
                msg.role === "fan"
                  ? "mr-auto bg-gray-800 text-white"
                  : "ml-auto bg-indigo-600 text-white"
              )}
            >
              <p className="text-sm">{msg.content}</p>
              <span className="mt-1 block text-[10px] opacity-50">
                {new Date(msg.createdAt).toLocaleTimeString("es-ES", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          ))}

          {/* Loading indicator while AI generates */}
          {isGenerating && (
            <div className="mr-auto flex items-center gap-3 rounded-2xl bg-gray-800/60 px-4 py-3">
              <div className="flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:0ms]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:150ms]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:300ms]" />
              </div>
              <span className="text-sm text-gray-400">
                La IA está generando sugerencias...
              </span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* AI Suggestions */}
      {suggestions.length > 0 && (
        <div className="border-t border-gray-800 bg-gray-900/50 px-6 py-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
              Sugerencias IA
            </p>
            <button
              onClick={handleRegenerate}
              disabled={isGenerating}
              className="flex items-center gap-1.5 rounded-lg border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-50"
            >
              <svg
                className={cn("h-3 w-3", isGenerating && "animate-spin")}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Regenerar
            </button>
          </div>
          <div className="space-y-2">
            {suggestions.map((suggestion, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-lg border border-gray-700 bg-gray-800 p-3"
              >
                <p className="flex-1 text-sm text-gray-200">{suggestion}</p>
                <button
                  onClick={() => handleUseSuggestion(suggestion, i)}
                  disabled={addCreatorMessage.isPending}
                  className="flex flex-shrink-0 items-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {copiedIndex === i ? (
                    "Copiado!"
                  ) : (
                    <>
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                        />
                      </svg>
                      Usar
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-gray-800 px-6 py-4">
        <div className="flex gap-3">
          <input
            value={fanMessage}
            onChange={(e) => setFanMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendFanMessage();
              }
            }}
            placeholder="Pega aquí el mensaje del fan..."
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            disabled={isGenerating}
          />
          <button
            onClick={handleSendFanMessage}
            disabled={isGenerating || !fanMessage.trim()}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isGenerating ? "Generando..." : "Enviar"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-gray-500">
          Pega el mensaje que te ha enviado el fan. La IA generará una
          sugerencia de respuesta.
        </p>
      </div>
    </div>
  );
}
