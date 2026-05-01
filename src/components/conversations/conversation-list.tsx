"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { ConversationListSkeleton } from "@/components/ui/skeleton";
import { useRealtimeContext } from "@/hooks/use-realtime";

type Conversation = {
  id: string;
  platformType: string;
  lastMessageAt: Date;
  status: string;
  isPinned: boolean;
  contact: {
    username: string;
    displayName: string | null;
    avatarUrl?: string | null;
    platformType: string;
    profile: {
      paymentProbability: number;
      funnelStage: string;
      engagementLevel: number;
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

const funnelLabels: Record<string, string> = {
  cold: "Frio",
  curious: "Curioso",
  interested: "Interesado",
  hot_lead: "Hot Lead",
  buyer: "Comprador",
  vip: "VIP",
};

type ViewTab = "active" | "archived";
type SortMode = "recent" | "engagement" | "payment";

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
  const { newMessageConversations, markConversationSeen } = useRealtimeContext();
  const [searchTerm, setSearchTerm] = useState("");
  const [collapsedPlatforms, setCollapsedPlatforms] = useState<Set<string>>(
    new Set()
  );
  const [viewTab, setViewTab] = useState<ViewTab>("active");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [platformFilter, setPlatformFilter] = useState<string | null>(null);
  const [funnelFilter, setFunnelFilter] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const utils = trpc.useUtils();
  const togglePin = trpc.conversations.togglePin.useMutation({
    onSuccess: () => utils.conversations.list.invalidate(),
  });
  const updateStatus = trpc.conversations.updateStatus.useMutation({
    onSuccess: () => utils.conversations.list.invalidate(),
  });

  // Split by status
  const activeConversations = useMemo(
    () => conversations.filter((c) => c.status !== "archived"),
    [conversations]
  );
  const archivedConversations = useMemo(
    () => conversations.filter((c) => c.status === "archived"),
    [conversations]
  );

  const baseList = viewTab === "active" ? activeConversations : archivedConversations;

  // Filter
  const filtered = useMemo(() => {
    let result = baseList;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (c) =>
          c.contact.username.toLowerCase().includes(term) ||
          c.contact.displayName?.toLowerCase().includes(term)
      );
    }

    if (platformFilter) {
      result = result.filter((c) => c.platformType === platformFilter);
    }

    if (funnelFilter) {
      result = result.filter(
        (c) => c.contact.profile?.funnelStage === funnelFilter
      );
    }

    return result;
  }, [baseList, searchTerm, platformFilter, funnelFilter]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];

    if (sortMode === "engagement") {
      arr.sort(
        (a, b) =>
          (b.contact.profile?.engagementLevel ?? 0) -
          (a.contact.profile?.engagementLevel ?? 0)
      );
    } else if (sortMode === "payment") {
      arr.sort(
        (a, b) =>
          (b.contact.profile?.paymentProbability ?? 0) -
          (a.contact.profile?.paymentProbability ?? 0)
      );
    } else {
      arr.sort(
        (a, b) =>
          new Date(b.lastMessageAt).getTime() -
          new Date(a.lastMessageAt).getTime()
      );
    }

    // Pinned always first
    arr.sort((a, b) => (a.isPinned === b.isPinned ? 0 : a.isPinned ? -1 : 1));

    return arr;
  }, [filtered, sortMode]);

  // Group by platform
  const grouped = useMemo(() => {
    const groups: Record<string, Conversation[]> = {};
    for (const conv of sorted) {
      const key = conv.platformType;
      if (!groups[key]) groups[key] = [];
      groups[key].push(conv);
    }
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [sorted]);

  // Available platforms for filter
  const availablePlatforms = useMemo(() => {
    const set = new Set(conversations.map((c) => c.platformType));
    return Array.from(set);
  }, [conversations]);

  // Available funnel stages for filter
  const availableFunnels = useMemo(() => {
    const set = new Set(
      conversations
        .map((c) => c.contact.profile?.funnelStage)
        .filter(Boolean) as string[]
    );
    return Array.from(set);
  }, [conversations]);

  const activeFiltersCount =
    (platformFilter ? 1 : 0) + (funnelFilter ? 1 : 0);

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

  function handlePin(e: React.MouseEvent, convId: string, current: boolean) {
    e.stopPropagation();
    togglePin.mutate({ id: convId, isPinned: !current });
  }

  function handleArchive(e: React.MouseEvent, convId: string) {
    e.stopPropagation();
    updateStatus.mutate({ id: convId, status: "archived" });
  }

  function handleUnarchive(e: React.MouseEvent, convId: string) {
    e.stopPropagation();
    updateStatus.mutate({ id: convId, status: "active" });
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
        <span className="text-sm text-gray-400">{sorted.length}</span>
      </div>

      {/* View tabs: Active / Archived */}
      <div className="flex border-b border-gray-800">
        <button
          onClick={() => setViewTab("active")}
          className={cn(
            "flex-1 py-2 text-center text-xs font-medium transition-colors",
            viewTab === "active"
              ? "border-b-2 border-indigo-500 text-white"
              : "text-gray-400 hover:text-white"
          )}
        >
          Activas ({activeConversations.length})
        </button>
        <button
          onClick={() => setViewTab("archived")}
          className={cn(
            "flex-1 py-2 text-center text-xs font-medium transition-colors",
            viewTab === "archived"
              ? "border-b-2 border-indigo-500 text-white"
              : "text-gray-400 hover:text-white"
          )}
        >
          Archivadas ({archivedConversations.length})
        </button>
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

      {/* Sort + Filter toggle */}
      <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-2">
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300 focus:border-indigo-500 focus:outline-none"
        >
          <option value="recent">Recientes</option>
          <option value="engagement">Engagement</option>
          <option value="payment">Prob. pago</option>
        </select>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            "flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors",
            showFilters || activeFiltersCount > 0
              ? "border-indigo-500 text-indigo-400"
              : "border-gray-700 text-gray-400 hover:text-white"
          )}
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Filtros
          {activeFiltersCount > 0 && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold text-white">
              {activeFiltersCount}
            </span>
          )}
        </button>
        {activeFiltersCount > 0 && (
          <button
            onClick={() => { setPlatformFilter(null); setFunnelFilter(null); }}
            className="text-xs text-gray-500 hover:text-white"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Filter chips */}
      {showFilters && (
        <div className="space-y-2 border-b border-gray-800 px-4 py-2">
          {/* Platform filter */}
          <div>
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-gray-500">
              Plataforma
            </span>
            <div className="flex flex-wrap gap-1">
              {availablePlatforms.map((p) => (
                <button
                  key={p}
                  onClick={() =>
                    setPlatformFilter(platformFilter === p ? null : p)
                  }
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                    platformFilter === p
                      ? "bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40"
                      : "bg-gray-800 text-gray-400 hover:text-white"
                  )}
                >
                  {platformLabels[p] ?? p}
                </button>
              ))}
            </div>
          </div>

          {/* Funnel stage filter */}
          <div>
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-gray-500">
              Etapa
            </span>
            <div className="flex flex-wrap gap-1">
              {availableFunnels.map((f) => (
                <button
                  key={f}
                  onClick={() =>
                    setFunnelFilter(funnelFilter === f ? null : f)
                  }
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                    funnelFilter === f
                      ? "bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40"
                      : "bg-gray-800 text-gray-400 hover:text-white"
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      funnelColors[f] ?? "bg-gray-500"
                    )}
                  />
                  {funnelLabels[f] ?? f}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">
            {viewTab === "archived"
              ? "No hay conversaciones archivadas"
              : activeFiltersCount > 0 || searchTerm
                ? "No hay resultados con estos filtros"
                : "No hay conversaciones aun"}
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
                      onClick={() => {
                        onSelect(conv.id);
                        markConversationSeen(conv.id);
                      }}
                      className={cn(
                        "group flex w-full items-center gap-3 border-b border-gray-800/50 px-4 py-3 text-left transition-colors",
                        selectedId === conv.id
                          ? "bg-gray-800"
                          : "hover:bg-gray-800/30"
                      )}
                    >
                      {/* Avatar */}
                      <div className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gray-700 text-xs font-bold text-white overflow-hidden">
                        {newMessageConversations.has(conv.id) && selectedId !== conv.id && (
                          <span className="absolute -right-0.5 -top-0.5 z-10 h-3 w-3 rounded-full border-2 border-gray-900 bg-blue-500 animate-pulse" />
                        )}
                        {conv.contact.avatarUrl ? (
                          <img
                            src={conv.contact.avatarUrl}
                            alt={conv.contact.displayName || conv.contact.username}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          (
                            conv.contact.displayName?.[0] ||
                            conv.contact.username[0] ||
                            "?"
                          ).toUpperCase()
                        )}
                        {conv.isPinned && (
                          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-indigo-500 text-[8px] text-white">
                            <svg className="h-2 w-2" fill="currentColor" viewBox="0 0 16 16">
                              <path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5a.5.5 0 0 1-1 0V10h-4A.5.5 0 0 1 3 9.5c0-.973.64-1.725 1.17-2.189A5.921 5.921 0 0 1 5 6.708V2.277a2.77 2.77 0 0 1-.354-.298C4.342 1.674 4 1.179 4 .5a.5.5 0 0 1 .146-.354z" />
                            </svg>
                          </span>
                        )}
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

                      {/* Quick actions (visible on hover) */}
                      <div className="flex flex-shrink-0 flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={(e) => handlePin(e, conv.id, conv.isPinned)}
                          title={conv.isPinned ? "Desfijar" : "Fijar"}
                          className={cn(
                            "rounded p-0.5 transition-colors",
                            conv.isPinned
                              ? "text-indigo-400 hover:text-indigo-300"
                              : "text-gray-500 hover:text-white"
                          )}
                        >
                          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5a.5.5 0 0 1-1 0V10h-4A.5.5 0 0 1 3 9.5c0-.973.64-1.725 1.17-2.189A5.921 5.921 0 0 1 5 6.708V2.277a2.77 2.77 0 0 1-.354-.298C4.342 1.674 4 1.179 4 .5a.5.5 0 0 1 .146-.354z" />
                          </svg>
                        </button>
                        {viewTab === "active" ? (
                          <button
                            onClick={(e) => handleArchive(e, conv.id)}
                            title="Archivar"
                            className="rounded p-0.5 text-gray-500 transition-colors hover:text-yellow-400"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                            </svg>
                          </button>
                        ) : (
                          <button
                            onClick={(e) => handleUnarchive(e, conv.id)}
                            title="Restaurar"
                            className="rounded p-0.5 text-gray-500 transition-colors hover:text-green-400"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                            </svg>
                          </button>
                        )}
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
