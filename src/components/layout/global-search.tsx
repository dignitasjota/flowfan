"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { PLATFORM_LABELS, type PlatformType } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<{
    platform?: PlatformType;
    role?: "fan" | "creator";
  }>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Cmd+K shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
      if (e.key === "Escape") {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const { data, isLoading } = trpc.search.search.useQuery(
    {
      query: debouncedQuery,
      limit: 10,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    },
    {
      enabled: debouncedQuery.length >= 2 && isOpen,
    }
  );

  const handleSelect = useCallback(
    (conversationId: string, messageId: string) => {
      setIsOpen(false);
      setQuery("");
      router.push(
        `/conversations?id=${conversationId}&messageId=${messageId}`
      );
    },
    [router]
  );

  const formatDate = (date: Date) => {
    const d = new Date(date);
    return d.toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    });
  };

  return (
    <div ref={containerRef} className="relative px-3 py-2">
      {/* Search input */}
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
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value.length > 0) setIsOpen(true);
          }}
          onFocus={() => {
            if (query.length > 0) setIsOpen(true);
          }}
          placeholder="Buscar mensajes..."
          className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pl-9 pr-16 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-gray-600 bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400">
          {typeof navigator !== "undefined" &&
          navigator.platform?.includes("Mac")
            ? "⌘K"
            : "Ctrl+K"}
        </kbd>
      </div>

      {/* Dropdown */}
      {isOpen && debouncedQuery.length >= 2 && (
        <div className="absolute left-3 right-3 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 shadow-xl">
          {/* Filters */}
          <div className="border-b border-gray-800 px-3 py-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="text-xs text-gray-400 hover:text-gray-300"
            >
              {showFilters ? "Ocultar filtros" : "Filtros"}
              {(filters.platform || filters.role) && (
                <span className="ml-1 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] text-white">
                  {[filters.platform, filters.role].filter(Boolean).length}
                </span>
              )}
            </button>
            {showFilters && (
              <div className="mt-2 flex flex-wrap gap-2">
                {/* Platform filter */}
                <select
                  value={filters.platform ?? ""}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      platform: (e.target.value || undefined) as
                        | PlatformType
                        | undefined,
                    }))
                  }
                  className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300"
                >
                  <option value="">Plataforma</option>
                  {Object.entries(PLATFORM_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
                {/* Role filter */}
                <select
                  value={filters.role ?? ""}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      role: (e.target.value || undefined) as
                        | "fan"
                        | "creator"
                        | undefined,
                    }))
                  }
                  className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300"
                >
                  <option value="">Rol</option>
                  <option value="fan">Fan</option>
                  <option value="creator">Creador</option>
                </select>
                {(filters.platform || filters.role) && (
                  <button
                    onClick={() => setFilters({})}
                    className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-400 hover:text-white"
                  >
                    Limpiar
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Results */}
          {isLoading ? (
            <div className="space-y-2 p-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse space-y-1">
                  <div className="h-3 w-1/3 rounded bg-gray-800" />
                  <div className="h-4 w-full rounded bg-gray-800" />
                </div>
              ))}
            </div>
          ) : data?.items.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500">
              Sin resultados para &ldquo;{debouncedQuery}&rdquo;
            </div>
          ) : (
            <>
              <ul>
                {data?.items.map((item) => (
                  <li key={item.messageId}>
                    <button
                      onClick={() =>
                        handleSelect(item.conversationId, item.messageId)
                      }
                      className="w-full px-3 py-2.5 text-left transition-colors hover:bg-gray-800"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-medium",
                            item.role === "fan"
                              ? "bg-blue-900/50 text-blue-400"
                              : "bg-emerald-900/50 text-emerald-400"
                          )}
                        >
                          {item.role === "fan" ? "FAN" : "TU"}
                        </span>
                        <span className="text-xs font-medium text-gray-300">
                          {item.contactDisplayName ?? item.contactUsername}
                        </span>
                        <span className="text-[10px] text-gray-600">
                          {PLATFORM_LABELS[item.platformType as PlatformType]}
                        </span>
                        <span className="ml-auto text-[10px] text-gray-600">
                          {formatDate(item.createdAt)}
                        </span>
                      </div>
                      <p
                        className="mt-1 text-xs leading-relaxed text-gray-400 [&_mark]:bg-yellow-600/30 [&_mark]:text-yellow-200"
                        dangerouslySetInnerHTML={{ __html: item.snippet }}
                      />
                    </button>
                  </li>
                ))}
              </ul>
              {data && data.total > 10 && (
                <div className="border-t border-gray-800 px-3 py-2 text-center text-xs text-gray-500">
                  {data.total} resultados encontrados
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
