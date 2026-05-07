"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { SchedulerCalendar } from "@/components/scheduler/scheduler-calendar";
import { PostComposer } from "@/components/scheduler/post-composer";
import { AccountsPanel } from "@/components/scheduler/accounts-panel";

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Programado",
  processing: "Publicando",
  posted: "Publicado",
  partial: "Parcial",
  failed: "Falló",
  cancelled: "Cancelado",
};

const STATUS_BADGE: Record<string, string> = {
  scheduled: "bg-blue-500/20 text-blue-300",
  processing: "bg-amber-500/20 text-amber-300",
  posted: "bg-emerald-500/20 text-emerald-300",
  partial: "bg-orange-500/20 text-orange-300",
  failed: "bg-red-500/20 text-red-300",
  cancelled: "bg-gray-700/30 text-gray-400",
};

const PLATFORM_ICONS: Record<string, string> = {
  reddit: "👽",
  twitter: "🐦",
  instagram: "📷",
};

export default function SchedulerPage() {
  const [tab, setTab] = useState<"calendar" | "list" | "accounts">("calendar");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerDate, setComposerDate] = useState<Date | undefined>(undefined);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const accounts = trpc.scheduler.listAccounts.useQuery();
  const list = trpc.scheduler.list.useQuery();
  const cancel = trpc.scheduler.cancel.useMutation({
    onSuccess: () => {
      utils.scheduler.list.invalidate();
      setSelectedPostId(null);
    },
  });

  function openComposer(date?: Date) {
    setComposerDate(date);
    setComposerOpen(true);
  }

  const selectedPost = list.data?.find((p) => p.id === selectedPostId);

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Scheduler</h1>
          <p className="text-sm text-gray-400">
            Programa publicaciones nativas en Reddit o vía webhook en cualquier
            otra plataforma.
          </p>
        </div>
        <button
          onClick={() => openComposer()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          + Programar
        </button>
      </div>

      <div className="flex gap-1 border-b border-gray-800">
        {(
          [
            ["calendar", "📅 Calendario"],
            ["list", "📋 Lista"],
            ["accounts", "🔗 Cuentas"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium transition",
              tab === id
                ? "border-indigo-500 text-white"
                : "border-transparent text-gray-400 hover:text-white"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "calendar" && (
        <SchedulerCalendar
          posts={(list.data ?? []).map((p) => ({
            id: p.id,
            title: p.title,
            content: p.content,
            scheduleAt: p.scheduleAt,
            status: p.status,
            targetPlatforms: p.targetPlatforms,
          }))}
          onSelectPost={(id) => setSelectedPostId(id)}
          onSelectDay={(date) => openComposer(date)}
        />
      )}

      {tab === "list" && (
        <div className="overflow-hidden rounded-lg border border-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60 text-xs uppercase text-gray-400">
              <tr>
                <th className="p-3 text-left">Fecha</th>
                <th className="p-3 text-left">Plataformas</th>
                <th className="p-3 text-left">Título / Contenido</th>
                <th className="p-3 text-left">Estado</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {list.data && list.data.length > 0 ? (
                list.data.map((p) => (
                  <tr
                    key={p.id}
                    className="border-t border-gray-800 hover:bg-gray-900/40"
                  >
                    <td className="p-3 text-gray-300">
                      {new Date(p.scheduleAt).toLocaleString("es-ES", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="p-3">
                      {p.targetPlatforms.map((t) => (
                        <span key={t} className="mr-1" title={t}>
                          {PLATFORM_ICONS[t] ?? "🌐"}
                        </span>
                      ))}
                    </td>
                    <td className="p-3 text-gray-200">
                      <div className="max-w-md truncate">
                        {p.title || p.content.slice(0, 100)}
                      </div>
                    </td>
                    <td className="p-3">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs",
                          STATUS_BADGE[p.status]
                        )}
                      >
                        {STATUS_LABELS[p.status] ?? p.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => setSelectedPostId(p.id)}
                        className="text-xs text-indigo-400 hover:underline"
                      >
                        Detalle
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-sm text-gray-500">
                    Sin publicaciones programadas. Pulsa "+ Programar" para
                    empezar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "accounts" && <AccountsPanel />}

      {composerOpen && (
        <PostComposer
          initialDate={composerDate}
          accounts={(accounts.data ?? []).map((a) => ({
            platformType: a.platformType,
            connectionType: a.connectionType,
            isActive: a.isActive,
          }))}
          onClose={() => setComposerOpen(false)}
          onCreated={() => {
            setComposerOpen(false);
            utils.scheduler.list.invalidate();
          }}
        />
      )}

      {selectedPost && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                Detalle de publicación
              </h2>
              <button
                onClick={() => setSelectedPostId(null)}
                className="rounded-md p-1 text-gray-500 hover:bg-gray-800 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-gray-400">Estado:</span>{" "}
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs",
                    STATUS_BADGE[selectedPost.status]
                  )}
                >
                  {STATUS_LABELS[selectedPost.status] ?? selectedPost.status}
                </span>
              </div>
              <div>
                <span className="text-gray-400">Programado para:</span>{" "}
                <span className="text-gray-200">
                  {new Date(selectedPost.scheduleAt).toLocaleString("es-ES")}
                </span>
              </div>
              <div>
                <span className="text-gray-400">Plataformas:</span>{" "}
                <span className="text-gray-200">
                  {selectedPost.targetPlatforms.join(", ")}
                </span>
              </div>
              {selectedPost.title && (
                <div>
                  <span className="text-gray-400">Título:</span>{" "}
                  <span className="text-gray-200">{selectedPost.title}</span>
                </div>
              )}
              <div>
                <span className="text-gray-400">Contenido:</span>
                <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-950 p-2 text-xs text-gray-200">
                  {selectedPost.content}
                </pre>
              </div>
              {selectedPost.lastError && (
                <div>
                  <span className="text-red-400">Error:</span>
                  <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md bg-red-950/30 p-2 text-xs text-red-300">
                    {selectedPost.lastError}
                  </pre>
                </div>
              )}
              {(() => {
                const ids = (selectedPost.externalPostIds ?? {}) as Record<
                  string,
                  { id?: string; url?: string }
                >;
                if (Object.keys(ids).length === 0) return null;
                return (
                  <div>
                    <span className="text-gray-400">URLs publicadas:</span>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {Object.entries(ids).map(([platform, info]) => (
                        <li key={platform}>
                          {PLATFORM_ICONS[platform] ?? "🌐"}{" "}
                          {info.url ? (
                            <a
                              href={info.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-indigo-400 hover:underline"
                            >
                              {info.url}
                            </a>
                          ) : (
                            <span className="text-gray-500">{info.id}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              {(selectedPost.status === "scheduled" ||
                selectedPost.status === "failed") && (
                <button
                  onClick={() => cancel.mutate({ id: selectedPost.id })}
                  disabled={cancel.isPending}
                  className="rounded-md bg-red-500/20 px-3 py-1 text-xs text-red-300 hover:bg-red-500/30 disabled:opacity-50"
                >
                  Cancelar
                </button>
              )}
              <button
                onClick={() => setSelectedPostId(null)}
                className="rounded-md bg-gray-800 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
