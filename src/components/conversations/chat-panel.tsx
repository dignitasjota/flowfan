"use client";

import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useTrpcErrorHandler } from "@/hooks/useTrpcErrorHandler";
import { useToast } from "@/components/ui/toast";
import { MediaPicker } from "@/components/media/media-picker";

type Message = {
  id: string;
  role: "fan" | "creator";
  content: string;
  aiSuggestion: string | null;
  createdAt: Date;
};

type Conversation = {
  id: string;
  contactId: string;
  platformType: string;
  contact: {
    id: string;
    username: string;
    displayName: string | null;
  };
  messages: Message[];
};

type SuggestionVariant = {
  type: "casual" | "sales" | "retention";
  label: string;
  content: string;
};

type Props = {
  conversation: Conversation;
  onMessageSent: () => void;
  onBack?: () => void;
  onToggleContact?: () => void;
};

export function ChatPanel({ conversation, onMessageSent, onBack, onToggleContact }: Props) {
  const [fanMessage, setFanMessage] = useState("");
  const [creatorMessage, setCreatorMessage] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [variants, setVariants] = useState<SuggestionVariant[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [isSendingManual, setIsSendingManual] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [showScheduleFor, setShowScheduleFor] = useState<number | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [showScheduleManual, setShowScheduleManual] = useState(false);
  const [scheduleManualDate, setScheduleManualDate] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const utils = trpc.useUtils();
  const suggestMutation = trpc.ai.suggest.useMutation();
  const regenerateMutation = trpc.ai.regenerate.useMutation();
  const addCreatorMessage = trpc.messages.addCreatorMessage.useMutation({
    onMutate: async (input) => {
      await utils.conversations.getById.cancel({ id: conversation.id });
      return { content: input.content };
    },
    onSettled: () => {
      utils.conversations.getById.invalidate({ id: conversation.id });
    },
  });
  const addFanMessage = trpc.messages.addFanMessage.useMutation({
    onMutate: async (input) => {
      await utils.conversations.getById.cancel({ id: conversation.id });
      return { content: input.content };
    },
    onSettled: () => {
      utils.conversations.getById.invalidate({ id: conversation.id });
    },
  });
  const scheduleMutation = trpc.scheduledMessages.create.useMutation({
    onSuccess: () => {
      toastSuccess("Mensaje programado correctamente");
      setShowScheduleFor(null);
      setScheduleDate("");
      setShowScheduleManual(false);
      setScheduleManualDate("");
    },
  });
  const optimalTimeQuery = trpc.scheduledMessages.suggestOptimalTime.useQuery(
    { contactId: conversation.contactId },
    { enabled: false }
  );
  const usageQuery = trpc.billing.getUsage.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const { handleError } = useTrpcErrorHandler();
  const { success: toastSuccess } = useToast();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.messages, isGenerating]);

  async function handleSendFanMessage() {
    if (!fanMessage.trim()) return;

    setIsGenerating(true);
    setSuggestions([]);
    setVariants([]);

    try {
      const result = await suggestMutation.mutateAsync({
        conversationId: conversation.id,
        fanMessage: fanMessage.trim(),
      });

      setSuggestions(result.suggestions);
      setVariants(result.variants ?? []);
      setFanMessage("");
      onMessageSent();
    } catch (error) {
      if (!handleError(error)) {
        console.error("Error generating suggestions:", error);
      }
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSendManual() {
    if (!fanMessage.trim() && !creatorMessage.trim()) return;
    setIsSendingManual(true);

    try {
      // Save fan message if provided
      if (fanMessage.trim()) {
        await addFanMessage.mutateAsync({
          conversationId: conversation.id,
          content: fanMessage.trim(),
        });
      }

      // Save creator message if provided
      if (creatorMessage.trim()) {
        await addCreatorMessage.mutateAsync({
          conversationId: conversation.id,
          content: creatorMessage.trim(),
        });
      }

      setFanMessage("");
      setCreatorMessage("");
      onMessageSent();
    } catch {
      // Error handled by tRPC
    } finally {
      setIsSendingManual(false);
    }
  }

  async function handleUseSuggestion(suggestion: string, index: number) {
    // Copy to clipboard
    await navigator.clipboard.writeText(suggestion);
    setCopiedIndex(index);
    toastSuccess("Respuesta copiada al portapapeles");
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
    setVariants([]);

    try {
      const result = await regenerateMutation.mutateAsync({
        conversationId: conversation.id,
      });

      setSuggestions(result.suggestions);
      setVariants(result.variants ?? []);
    } catch (error) {
      if (!handleError(error)) {
        console.error("Error regenerating suggestions:", error);
      }
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

        {/* Manual mode toggle */}
        <button
          onClick={() => {
            setManualMode(!manualMode);
            setSuggestions([]);
            setCreatorMessage("");
          }}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
            manualMode
              ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
              : "border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white"
          )}
          title={manualMode ? "Desactivar modo manual" : "Activar modo manual"}
        >
          {manualMode ? (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          )}
          {manualMode ? "Manual" : "Manual"}
        </button>

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

      {/* Manual mode banner */}
      {manualMode && (
        <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/5 px-6 py-2">
          <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-xs text-amber-400/80">
            Modo manual: la IA no genera sugerencias. Puedes registrar ambos lados de la conversacion.
          </span>
        </div>
      )}

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
                La IA esta generando sugerencias...
              </span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* AI Suggestions */}
      {suggestions.length > 0 && !manualMode && (
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
            {(variants.length > 0 ? variants : suggestions.map((s) => ({ type: "casual" as const, label: "Sugerencia", content: s }))).map((variant, i) => {
              const variantColors: Record<string, string> = {
                casual: "border-blue-500/40 bg-blue-500/10 text-blue-300",
                sales: "border-green-500/40 bg-green-500/10 text-green-300",
                retention: "border-purple-500/40 bg-purple-500/10 text-purple-300",
              };
              return (
                <div
                  key={i}
                  className="rounded-lg border border-gray-700 bg-gray-800 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                        variantColors[variant.type] ?? "border-gray-600 bg-gray-700 text-gray-300"
                      )}
                    >
                      {variant.label}
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleUseSuggestion(variant.content, i)}
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
                      <button
                        onClick={() => {
                          setShowScheduleFor(showScheduleFor === i ? null : i);
                          setScheduleDate("");
                        }}
                        className="flex flex-shrink-0 items-center gap-1 rounded border border-gray-600 px-2 py-1.5 text-xs text-gray-400 hover:bg-gray-700 hover:text-white"
                        title="Programar envio"
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-gray-200">{variant.content}</p>
                  {showScheduleFor === i && (
                    <div className="mt-2 flex items-center gap-2 rounded-lg border border-gray-600 bg-gray-900 p-2">
                      <input
                        type="datetime-local"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        min={new Date().toISOString().slice(0, 16)}
                        className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white focus:border-indigo-500 focus:outline-none"
                      />
                      <button
                        onClick={() => {
                          if (!scheduleDate) return;
                          scheduleMutation.mutate({
                            conversationId: conversation.id,
                            content: variant.content,
                            scheduledAt: new Date(scheduleDate).toISOString(),
                            aiSuggestion: variant.content,
                            aiSuggestionUsed: true,
                          });
                        }}
                        disabled={!scheduleDate || scheduleMutation.isPending}
                        className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {scheduleMutation.isPending ? "..." : "Programar"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-gray-800 px-6 py-4">
        {manualMode ? (
          /* Manual mode: two inputs */
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">
                Mensaje del fan
              </label>
              <input
                value={fanMessage}
                onChange={(e) => setFanMessage(e.target.value)}
                placeholder="Pega el mensaje que te envio el fan..."
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                disabled={isSendingManual}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">
                Tu respuesta
              </label>
              <input
                value={creatorMessage}
                onChange={(e) => setCreatorMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendManual();
                  }
                }}
                placeholder="Pega tu respuesta..."
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                disabled={isSendingManual}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowMediaPicker(true)}
                className="flex-shrink-0 rounded-lg border border-gray-700 p-2.5 text-gray-400 hover:border-indigo-500 hover:text-indigo-400 transition-colors"
                title="Adjuntar media"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
                </svg>
              </button>
              <button
                onClick={handleSendManual}
                disabled={isSendingManual || (!fanMessage.trim() && !creatorMessage.trim())}
                className="flex-1 rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {isSendingManual ? "Guardando..." : "Guardar mensajes"}
              </button>
              <button
                onClick={() => setShowScheduleManual(!showScheduleManual)}
                disabled={!creatorMessage.trim()}
                className="flex-shrink-0 rounded-lg border border-gray-700 p-2.5 text-gray-400 hover:border-blue-500 hover:text-blue-400 transition-colors disabled:opacity-50"
                title="Programar envio"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </button>
            </div>
            {showScheduleManual && creatorMessage.trim() && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/5 p-2.5">
                <svg className="h-4 w-4 flex-shrink-0 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                <input
                  type="datetime-local"
                  value={scheduleManualDate}
                  onChange={(e) => setScheduleManualDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                  className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white focus:border-indigo-500 focus:outline-none"
                />
                <button
                  onClick={() => {
                    if (!scheduleManualDate || !creatorMessage.trim()) return;
                    scheduleMutation.mutate({
                      conversationId: conversation.id,
                      content: creatorMessage.trim(),
                      scheduledAt: new Date(scheduleManualDate).toISOString(),
                    });
                    setCreatorMessage("");
                  }}
                  disabled={!scheduleManualDate || scheduleMutation.isPending}
                  className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {scheduleMutation.isPending ? "..." : "Programar"}
                </button>
              </div>
            )}
          </div>
        ) : (
          /* AI mode: single input */
          <>
            <div className="flex gap-3">
              <button
                onClick={() => setShowMediaPicker(true)}
                className="flex-shrink-0 rounded-lg border border-gray-700 p-2.5 text-gray-400 hover:border-indigo-500 hover:text-indigo-400 transition-colors"
                title="Adjuntar media"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
                </svg>
              </button>
              <input
                value={fanMessage}
                onChange={(e) => setFanMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendFanMessage();
                  }
                }}
                placeholder="Pega aqui el mensaje del fan..."
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
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[11px] text-gray-500">
                Pega el mensaje que te ha enviado el fan. La IA generara una
                sugerencia de respuesta.
              </p>
              {usageQuery.data && (
                <span className="flex-shrink-0 text-[11px] text-gray-500">
                  {usageQuery.data.usage.aiMessages.used}/
                  {usageQuery.data.usage.aiMessages.limit === -1
                    ? "ilim"
                    : usageQuery.data.usage.aiMessages.limit}{" "}
                  mensajes IA
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Media Picker */}
      {showMediaPicker && (
        <MediaPicker
          contactId={conversation.contactId}
          conversationId={conversation.id}
          onSelect={(mediaItem) => {
            setShowMediaPicker(false);
            // Register as creator message with media reference
            addCreatorMessage.mutate({
              conversationId: conversation.id,
              content: `[Media enviado: ${mediaItem.originalName}]`,
            });
            onMessageSent();
          }}
          onClose={() => setShowMediaPicker(false)}
        />
      )}
    </div>
  );
}
