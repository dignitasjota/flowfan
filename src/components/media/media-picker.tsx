"use client";

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type MediaItem = {
  id: string;
  originalName: string;
  mediaType: string;
  thumbnailPath: string | null;
};

type Props = {
  contactId: string;
  conversationId: string;
  onSelect: (mediaItem: MediaItem) => void;
  onClose: () => void;
};

const MEDIA_TYPE_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "image", label: "Imagen" },
  { value: "video", label: "Video" },
  { value: "gif", label: "GIF" },
];

const PAGE_SIZE = 24;

export function MediaPicker({ contactId, conversationId, onSelect, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [mediaType, setMediaType] = useState("");
  const [page, setPage] = useState(0);
  const [confirmItem, setConfirmItem] = useState<MediaItem | null>(null);

  const { data: mediaData, isLoading } = trpc.media.list.useQuery({
    search: search || undefined,
    mediaType: (mediaType || undefined) as "image" | "video" | "gif" | undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const items = mediaData?.items ?? [];
  const total = mediaData?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const mediaItemIds = useMemo(() => items.map((item: MediaItem) => item.id), [items]);

  const { data: sentStatus } = trpc.media.checkSentToContact.useQuery(
    { mediaItemIds, contactId },
    { enabled: mediaItemIds.length > 0 }
  );

  const markAsSent = trpc.media.markAsSent.useMutation();

  const handleSelect = async (item: MediaItem) => {
    const alreadySent = sentStatus?.[item.id];

    if (alreadySent && !confirmItem) {
      setConfirmItem(item);
      return;
    }

    setConfirmItem(null);

    try {
      await markAsSent.mutateAsync({
        mediaItemId: item.id,
        contactId,
        conversationId,
      });
      onSelect(item);
    } catch {
      // Error handling is delegated to tRPC error hooks
    }
  };

  const handleConfirmResend = () => {
    if (confirmItem) {
      handleSelect(confirmItem);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="relative flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-5 py-4">
          <h2 className="text-lg font-semibold text-white">Seleccionar media</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-3 border-b border-gray-700 px-5 py-3">
          <input
            type="text"
            placeholder="Buscar por nombre..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
          <select
            value={mediaType}
            onChange={(e) => {
              setMediaType(e.target.value);
              setPage(0);
            }}
            className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          >
            {MEDIA_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-indigo-500" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-gray-500">
              No se encontraron archivos
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {items.map((item: MediaItem) => {
                const isSent = sentStatus?.[item.id] ?? false;

                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    disabled={markAsSent.isPending}
                    className={cn(
                      "group relative aspect-square overflow-hidden rounded-lg border border-gray-700 bg-gray-800 transition-all hover:border-indigo-500 hover:ring-1 hover:ring-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500",
                      markAsSent.isPending && "cursor-wait opacity-50"
                    )}
                  >
                    <img
                      src={`/api/media/${item.id}?thumb=1`}
                      alt={item.originalName}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />

                    {/* Sent badge */}
                    {isSent && (
                      <div className="absolute inset-0 flex items-start justify-end bg-black/20 p-1.5">
                        <span className="rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-semibold text-black">
                          Ya enviado
                        </span>
                      </div>
                    )}

                    {/* Hover overlay with name */}
                    <div className="absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/80 to-transparent p-2 transition-transform group-hover:translate-y-0">
                      <p className="truncate text-xs text-white">{item.originalName}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-700 px-5 py-3">
            <span className="text-xs text-gray-400">
              {total} archivo{total !== 1 ? "s" : ""}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1 text-sm text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Anterior
              </button>
              <span className="flex items-center px-2 text-xs text-gray-400">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1 text-sm text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}

        {/* Confirm resend dialog */}
        {confirmItem && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/70">
            <div className="mx-4 max-w-sm rounded-lg border border-gray-700 bg-gray-900 p-5 shadow-xl">
              <p className="mb-4 text-sm text-gray-300">
                Este archivo ya fue enviado a este fan. ¿Enviar de nuevo?
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setConfirmItem(null)}
                  className="rounded-md border border-gray-600 bg-gray-800 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-700"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmResend}
                  disabled={markAsSent.isPending}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
                >
                  {markAsSent.isPending ? "Enviando..." : "Enviar de nuevo"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
