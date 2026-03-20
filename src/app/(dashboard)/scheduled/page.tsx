"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "pending" | "sent" | "cancelled" | "failed";

const statusLabels: Record<string, string> = {
  pending: "Pendiente",
  sent: "Enviado",
  cancelled: "Cancelado",
  failed: "Fallido",
};

const statusStyles: Record<string, string> = {
  pending: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  sent: "bg-green-500/10 text-green-400 border-green-500/30",
  cancelled: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  failed: "bg-red-500/10 text-red-400 border-red-500/30",
};

export default function ScheduledMessagesPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editDate, setEditDate] = useState("");

  const scheduledQuery = trpc.scheduledMessages.list.useQuery(
    statusFilter === "all" ? undefined : { status: statusFilter }
  );
  const cancelMutation = trpc.scheduledMessages.cancel.useMutation({
    onSuccess: () => scheduledQuery.refetch(),
  });
  const updateMutation = trpc.scheduledMessages.update.useMutation({
    onSuccess: () => {
      scheduledQuery.refetch();
      setEditingId(null);
    },
  });

  const items = scheduledQuery.data ?? [];

  function formatDate(date: Date | string) {
    return new Date(date).toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatRelative(date: Date | string) {
    const d = new Date(date);
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    if (diff < 0) return "pasado";
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 24) return `en ${Math.floor(hours / 24)}d ${hours % 24}h`;
    if (hours > 0) return `en ${hours}h ${minutes}m`;
    return `en ${minutes}m`;
  }

  function startEdit(item: { id: string; content: string; scheduledAt: Date | string }) {
    setEditingId(item.id);
    setEditContent(item.content);
    // Format date for datetime-local input
    const d = new Date(item.scheduledAt);
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    setEditDate(local.toISOString().slice(0, 16));
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Mensajes Programados</h1>
            <p className="mt-1 text-sm text-gray-400">
              Programa mensajes para enviar en el momento optimo.
            </p>
          </div>
        </div>

        {/* Status filters */}
        <div className="mt-4 flex gap-2">
          {(["all", "pending", "sent", "cancelled", "failed"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                statusFilter === s
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
              )}
            >
              {s === "all" ? "Todos" : statusLabels[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {scheduledQuery.isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-800" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 text-4xl">
              <svg className="mx-auto h-12 w-12 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-white">No hay mensajes programados</h3>
            <p className="mt-1 text-sm text-gray-400">
              Programa mensajes desde cualquier conversacion.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-gray-800 bg-gray-900 p-4"
              >
                {editingId === item.id ? (
                  /* Edit mode */
                  <div className="space-y-3">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                    />
                    <input
                      type="datetime-local"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          updateMutation.mutate({
                            id: item.id,
                            content: editContent,
                            scheduledAt: new Date(editDate).toISOString(),
                          });
                        }}
                        disabled={updateMutation.isPending}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {updateMutation.isPending ? "Guardando..." : "Guardar"}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="mb-2 flex items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                              statusStyles[item.status]
                            )}
                          >
                            {statusLabels[item.status]}
                          </span>
                          <span className="text-xs text-gray-500">
                            {item.contact?.displayName ?? item.contact?.username ?? "—"}
                          </span>
                          <span className="text-xs text-gray-600">
                            {item.conversation?.platformType ?? ""}
                          </span>
                        </div>
                        <p className="text-sm text-gray-200">{item.content}</p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span title={formatDate(item.scheduledAt)}>
                          <svg className="mr-1 inline h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                          </svg>
                          {formatDate(item.scheduledAt)}
                        </span>
                        {item.status === "pending" && (
                          <span className="text-blue-400">
                            ({formatRelative(item.scheduledAt)})
                          </span>
                        )}
                      </div>

                      {item.status === "pending" && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => startEdit(item)}
                            className="rounded-lg border border-gray-700 px-2.5 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => cancelMutation.mutate({ id: item.id })}
                            disabled={cancelMutation.isPending}
                            className="rounded-lg border border-red-800 px-2.5 py-1 text-xs text-red-400 hover:bg-red-900/30 disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                        </div>
                      )}

                      {item.status === "failed" && item.errorMessage && (
                        <span className="text-xs text-red-400" title={item.errorMessage}>
                          Error: {item.errorMessage.slice(0, 50)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
