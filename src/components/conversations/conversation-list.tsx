"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ConversationListSkeleton } from "@/components/ui/skeleton";

type Conversation = {
  id: string;
  platformType: string;
  lastMessageAt: Date;
  status: string;
  contact: {
    username: string;
    displayName: string | null;
    platformType: string;
    profile: {
      paymentProbability: number;
      funnelStage: string;
    } | null;
  };
};

const platformLabels: Record<string, string> = {
  instagram: "Instagram",
  tinder: "Tinder",
  reddit: "Reddit",
  onlyfans: "OnlyFans",
  twitter: "Twitter",
  telegram: "Telegram",
  snapchat: "Snapchat",
  other: "Otros",
};

const platformIcons: Record<string, string> = {
  instagram: "IG",
  tinder: "TN",
  reddit: "RD",
  onlyfans: "OF",
  twitter: "TW",
  telegram: "TG",
  snapchat: "SC",
  other: "??",
};

const funnelColors: Record<string, string> = {
  cold: "bg-gray-500",
  curious: "bg-blue-500",
  interested: "bg-yellow-500",
  hot_lead: "bg-orange-500",
  buyer: "bg-green-500",
  vip: "bg-purple-500",
};

type Props = {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
};

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  isLoading,
}: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [collapsedPlatforms, setCollapsedPlatforms] = useState<Set<string>>(
    new Set()
  );

  // Filter and group conversations by platform
  const filtered = useMemo(() => {
    if (!searchTerm) return conversations;
    const term = searchTerm.toLowerCase();
    return conversations.filter(
      (c) =>
        c.contact.username.toLowerCase().includes(term) ||
        c.contact.displayName?.toLowerCase().includes(term)
    );
  }, [conversations, searchTerm]);

  const grouped = useMemo(() => {
    const groups: Record<string, Conversation[]> = {};
    for (const conv of filtered) {
      const key = conv.platformType;
      if (!groups[key]) groups[key] = [];
      groups[key].push(conv);
    }
    // Sort platforms by number of conversations (most first)
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  function togglePlatform(platform: string) {
    setCollapsedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) {
        next.delete(platform);
      } else {
        next.add(platform);
      }
      return next;
    });
  }

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <h2 className="text-lg font-semibold text-white">Conversaciones</h2>
        </div>
        <ConversationListSkeleton />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <h2 className="text-lg font-semibold text-white">Conversaciones</h2>
        <span className="text-sm text-gray-400">{filtered.length}</span>
      </div>

      {/* Search */}
      <div className="border-b border-gray-800 px-4 py-2">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar contacto..."
            className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pl-10 pr-3 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">
            No hay conversaciones aún
          </p>
        ) : (
          grouped.map(([platform, convs]) => {
            const isCollapsed = collapsedPlatforms.has(platform);

            return (
              <div key={platform}>
                {/* Platform header */}
                <button
                  onClick={() => togglePlatform(platform)}
                  className="flex w-full items-center gap-2 bg-gray-900/80 px-4 py-2 text-left transition-colors hover:bg-gray-900"
                >
                  <svg
                    className={cn(
                      "h-3 w-3 text-gray-500 transition-transform",
                      isCollapsed ? "" : "rotate-90"
                    )}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {platformLabels[platform] ?? platform}
                  </span>
                  <span className="rounded-full bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500">
                    {convs.length}
                  </span>
                </button>

                {/* Conversation items */}
                {!isCollapsed &&
                  convs.map((conv) => (
                    <button
                      key={conv.id}
                      onClick={() => onSelect(conv.id)}
                      className={cn(
                        "flex w-full items-center gap-3 border-b border-gray-800/50 px-4 py-3 text-left transition-colors",
                        selectedId === conv.id
                          ? "bg-gray-800"
                          : "hover:bg-gray-800/30"
                      )}
                    >
                      {/* Avatar */}
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gray-700 text-xs font-bold text-white">
                        {(
                          conv.contact.displayName?.[0] ||
                          conv.contact.username[0] ||
                          "?"
                        ).toUpperCase()}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="truncate text-sm font-medium text-white">
                            {conv.contact.displayName || conv.contact.username}
                          </span>
                          {conv.contact.profile && (
                            <div
                              className={cn(
                                "h-2.5 w-2.5 rounded-full",
                                funnelColors[
                                  conv.contact.profile.funnelStage
                                ] ?? "bg-gray-500"
                              )}
                              title={conv.contact.profile.funnelStage}
                            />
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-400">
                            @{conv.contact.username}
                          </span>
                          {conv.contact.profile && (
                            <span className="text-xs text-gray-500">
                              {conv.contact.profile.paymentProbability}%
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
