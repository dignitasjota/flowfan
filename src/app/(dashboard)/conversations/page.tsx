"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ConversationList } from "@/components/conversations/conversation-list";
import { ChatPanel } from "@/components/conversations/chat-panel";
import { ContactPanel } from "@/components/conversations/contact-panel";
import { ShortcutsCheatsheet } from "@/components/conversations/shortcuts-cheatsheet";
import { useConversationShortcuts } from "@/hooks/use-conversation-shortcuts";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export default function ConversationsPage() {
  const searchParams = useSearchParams();
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [showContactPanel, setShowContactPanel] = useState(false);

  // Handle search result navigation via URL params
  useEffect(() => {
    const id = searchParams.get("id");
    const msgId = searchParams.get("messageId");
    if (id) {
      setSelectedConversationId(id);
      setHighlightMessageId(msgId);
    }
  }, [searchParams]);

  const utils = trpc.useUtils();
  const PAGE_SIZE = 100;
  const [listLimit, setListLimit] = useState(PAGE_SIZE);
  const conversationsQuery = trpc.conversations.list.useQuery(
    { limit: listLimit },
    { placeholderData: (prev) => prev }
  );
  const canLoadMore =
    (conversationsQuery.data?.length ?? 0) >= listLimit && listLimit < 1000;
  const conversationQuery = trpc.conversations.getById.useQuery(
    { id: selectedConversationId! },
    { enabled: !!selectedConversationId }
  );

  function handleSelectConversation(id: string) {
    setSelectedConversationId(id);
    setHighlightMessageId(null);
    setShowContactPanel(false);
  }

  function handleBack() {
    setSelectedConversationId(null);
    setShowContactPanel(false);
  }

  const hasConversation = selectedConversationId && conversationQuery.data;

  const [showShortcuts, setShowShortcuts] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const orderedIds = useMemo(
    () => (conversationsQuery.data ?? []).map((c) => c.id),
    [conversationsQuery.data]
  );

  const archiveMutation = trpc.conversations.updateStatus.useMutation({
    onSuccess: () => {
      utils.conversations.list.invalidate();
      setSelectedConversationId(null);
    },
  });

  useConversationShortcuts({
    onNext: () => {
      if (orderedIds.length === 0) return;
      const idx = selectedConversationId
        ? orderedIds.indexOf(selectedConversationId)
        : -1;
      const next = orderedIds[Math.min(idx + 1, orderedIds.length - 1)];
      if (next) handleSelectConversation(next);
    },
    onPrev: () => {
      if (orderedIds.length === 0) return;
      const idx = selectedConversationId
        ? orderedIds.indexOf(selectedConversationId)
        : 0;
      const prev = orderedIds[Math.max(idx - 1, 0)];
      if (prev) handleSelectConversation(prev);
    },
    onReply: () => {
      window.dispatchEvent(new CustomEvent("fanflow:focus-reply"));
    },
    // Pide confirmación: un atajo de una sola tecla no debe archivar sin aviso.
    onArchive: () => {
      if (!selectedConversationId) return;
      setConfirmArchive(true);
    },
    onShowHelp: () => setShowShortcuts(true),
  }, !confirmArchive && !showShortcuts);

  return (
    <div className="flex h-full">
      {/* Left panel - conversation list */}
      <div
        className={cn(
          "w-full border-r border-gray-800 lg:block lg:w-80",
          hasConversation ? "hidden" : "block"
        )}
      >
        <ConversationList
          conversations={conversationsQuery.data ?? []}
          selectedId={selectedConversationId}
          onSelect={handleSelectConversation}
          isLoading={conversationsQuery.isLoading}
          onLoadMore={canLoadMore ? () => setListLimit((l) => l + PAGE_SIZE) : undefined}
          isLoadingMore={conversationsQuery.isFetching && !conversationsQuery.isLoading}
        />
      </div>

      {/* Center panel - chat */}
      <div
        className={cn(
          "flex-1",
          hasConversation ? "block" : "hidden lg:block",
          showContactPanel && "hidden lg:block"
        )}
      >
        {hasConversation ? (
          <ChatPanel
            // FE-2: remontar al cambiar de conversación para resetear el estado
            // local (cola manual, sugerencias, inputs) y no arrastrarlo al fan B.
            key={conversationQuery.data!.id}
            conversation={{
              ...conversationQuery.data!,
              messages: conversationQuery.data!.messages.map((m) => ({
                ...m,
                sentiment: m.sentiment as Record<string, unknown> | null,
              })),
            }}
            onMessageSent={() => {
              utils.conversations.getById.invalidate({ id: selectedConversationId! });
              utils.conversations.list.invalidate();
              // FE-5: invalidación tRPC real (la key manual con string-punto no
              // matcheaba nada → el scoring del panel quedaba obsoleto).
              utils.intelligence.getContactScoring.invalidate({
                contactId: conversationQuery.data!.contact.id,
              });
            }}
            onBack={handleBack}
            onToggleContact={() => setShowContactPanel(!showContactPanel)}
            highlightMessageId={highlightMessageId}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-500">
            Selecciona una conversación para empezar
          </div>
        )}
      </div>

      {/* Right panel - contact info */}
      {hasConversation && (
        <div
          className={cn(
            "w-full border-l border-gray-800 lg:block lg:w-80",
            showContactPanel ? "block" : "hidden"
          )}
        >
          <ContactPanel
            contact={conversationQuery.data!.contact}
            conversationId={selectedConversationId}
            onBack={() => setShowContactPanel(false)}
          />
        </div>
      )}

      {confirmArchive && selectedConversationId && (
        <ConfirmDialog
          title="Archivar conversación"
          message="¿Archivar esta conversación? Podrás restaurarla desde la pestaña Archivadas."
          confirmLabel="Archivar"
          isDanger={false}
          isPending={archiveMutation.isPending}
          onCancel={() => setConfirmArchive(false)}
          onConfirm={() => {
            archiveMutation.mutate({ id: selectedConversationId, status: "archived" });
            setConfirmArchive(false);
          }}
        />
      )}

      <ShortcutsCheatsheet
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
    </div>
  );
}
