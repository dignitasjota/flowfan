"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { ConversationList } from "@/components/conversations/conversation-list";
import { ChatPanel } from "@/components/conversations/chat-panel";
import { ContactPanel } from "@/components/conversations/contact-panel";

export default function ConversationsPage() {
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [showContactPanel, setShowContactPanel] = useState(false);

  const queryClient = useQueryClient();
  const utils = trpc.useUtils();
  const conversationsQuery = trpc.conversations.list.useQuery();
  const conversationQuery = trpc.conversations.getById.useQuery(
    { id: selectedConversationId! },
    { enabled: !!selectedConversationId }
  );

  function handleSelectConversation(id: string) {
    setSelectedConversationId(id);
    setShowContactPanel(false);
  }

  function handleBack() {
    setSelectedConversationId(null);
    setShowContactPanel(false);
  }

  const hasConversation = selectedConversationId && conversationQuery.data;

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
            conversation={conversationQuery.data!}
            onMessageSent={() => {
              utils.conversations.getById.invalidate({ id: selectedConversationId! });
              utils.conversations.list.invalidate();
              queryClient.invalidateQueries({
                queryKey: [["intelligence.getContactScoring"]],
              });
            }}
            onBack={handleBack}
            onToggleContact={() => setShowContactPanel(!showContactPanel)}
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
    </div>
  );
}
