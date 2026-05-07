"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

type ConnectedAccount = {
  platformType: string;
  connectionType: "native" | "webhook";
  isActive: boolean;
};

type Props = {
  initialDate?: Date;
  accounts: ConnectedAccount[];
  onClose: () => void;
  onCreated: () => void;
};

const PLATFORM_LABELS: Record<string, string> = {
  reddit: "Reddit",
  twitter: "Twitter / X",
  instagram: "Instagram",
};

const PLATFORM_ICONS: Record<string, string> = {
  reddit: "👽",
  twitter: "🐦",
  instagram: "📷",
};

function formatDateTimeLocal(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function PostComposer({ initialDate, accounts, onClose, onCreated }: Props) {
  const defaultDate = initialDate ?? new Date(Date.now() + 60 * 60 * 1000);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scheduleAt, setScheduleAt] = useState(formatDateTimeLocal(defaultDate));
  const [subreddit, setSubreddit] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const create = trpc.scheduler.create.useMutation({
    onSuccess: () => {
      onCreated();
    },
    onError: (err) => setErrorMsg(err.message),
  });

  function togglePlatform(p: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  function submit() {
    setErrorMsg(null);
    const platforms = Array.from(selected);
    if (platforms.length === 0) {
      setErrorMsg("Selecciona al menos una plataforma.");
      return;
    }
    if (!content.trim()) {
      setErrorMsg("El contenido no puede estar vacío.");
      return;
    }
    const date = new Date(scheduleAt);
    if (Number.isNaN(date.getTime())) {
      setErrorMsg("Fecha inválida.");
      return;
    }

    const platformConfigs: Record<string, Record<string, unknown>> = {};
    if (selected.has("reddit")) {
      if (!subreddit.trim()) {
        setErrorMsg("Especifica el subreddit destino.");
        return;
      }
      platformConfigs.reddit = { subreddit: subreddit.trim() };
    }

    create.mutate({
      title: title.trim() || undefined,
      content: content.trim(),
      targetPlatforms: platforms as ("reddit" | "twitter" | "instagram")[],
      scheduleAt: date,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      mediaUrls: [],
      platformConfigs,
    });
  }

  const connectedSet = new Set(
    accounts.filter((a) => a.isActive).map((a) => a.platformType)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-xl rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Programar publicación</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-gray-400">
            Plataformas destino
          </span>
          <div className="flex flex-wrap gap-2">
            {(["reddit", "twitter", "instagram"] as const).map((p) => {
              const connected = connectedSet.has(p);
              const isSelected = selected.has(p);
              return (
                <button
                  key={p}
                  type="button"
                  disabled={!connected}
                  onClick={() => togglePlatform(p)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs font-medium transition",
                    isSelected
                      ? "border-indigo-500 bg-indigo-500/20 text-white"
                      : connected
                      ? "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600"
                      : "cursor-not-allowed border-gray-800 bg-gray-900 text-gray-600"
                  )}
                  title={connected ? "" : "Cuenta no conectada"}
                >
                  {PLATFORM_ICONS[p]} {PLATFORM_LABELS[p]}
                  {!connected && " · no conectada"}
                </button>
              );
            })}
          </div>
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-gray-400">Título</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título (obligatorio para Reddit)"
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-gray-400">
            Contenido
          </span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            placeholder="Escribe tu publicación..."
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
          <span className="mt-1 block text-xs text-gray-500">
            {content.length} caracteres
          </span>
        </label>

        {selected.has("reddit") && (
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-gray-400">
              Subreddit destino
            </span>
            <input
              value={subreddit}
              onChange={(e) => setSubreddit(e.target.value)}
              placeholder="ej. AskReddit (sin r/)"
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            />
          </label>
        )}

        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-gray-400">
            Programar para
          </span>
          <input
            type="datetime-local"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
          />
        </label>

        {errorMsg && (
          <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {errorMsg}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={create.isPending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {create.isPending ? "Programando..." : "Programar"}
          </button>
        </div>
      </div>
    </div>
  );
}
