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
  initialValues?: {
    title?: string;
    content?: string;
    platforms?: ("reddit" | "twitter" | "instagram")[];
    redditSubreddit?: string;
  };
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

type RedditKind = "self" | "link" | "image";
type Frequency = "daily" | "weekly" | "monthly";

export function PostComposer({
  initialDate,
  accounts,
  onClose,
  onCreated,
  initialValues,
}: Props) {
  const defaultDate = initialDate ?? new Date(Date.now() + 60 * 60 * 1000);
  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [content, setContent] = useState(initialValues?.content ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialValues?.platforms ?? [])
  );
  const [scheduleAt, setScheduleAt] = useState(formatDateTimeLocal(defaultDate));
  const [subreddit, setSubreddit] = useState(
    initialValues?.redditSubreddit ?? ""
  );
  const [redditKind, setRedditKind] = useState<RedditKind>("self");
  const [redditUrl, setRedditUrl] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [recFrequency, setRecFrequency] = useState<Frequency>("weekly");
  const [recDayOfWeek, setRecDayOfWeek] = useState(1);
  const [recDayOfMonth, setRecDayOfMonth] = useState(1);
  const [recHour, setRecHour] = useState(10);
  const [recMinute, setRecMinute] = useState(0);
  const [recUntil, setRecUntil] = useState("");
  const [recMaxCount, setRecMaxCount] = useState("");
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
      if ((redditKind === "link" || redditKind === "image") && !redditUrl.trim()) {
        setErrorMsg(
          redditKind === "link"
            ? "Pega la URL del enlace."
            : "Pega la URL pública de la imagen."
        );
        return;
      }
      platformConfigs.reddit = {
        subreddit: subreddit.trim(),
        kind: redditKind,
        ...(redditKind !== "self" ? { url: redditUrl.trim() } : {}),
      };
    }

    let recurrenceRule:
      | {
          frequency: Frequency;
          hour: number;
          minute: number;
          dayOfWeek?: number;
          dayOfMonth?: number;
          until?: string;
          maxCount?: number;
        }
      | undefined;
    if (recurring) {
      recurrenceRule = {
        frequency: recFrequency,
        hour: recHour,
        minute: recMinute,
        ...(recFrequency === "weekly" ? { dayOfWeek: recDayOfWeek } : {}),
        ...(recFrequency === "monthly" ? { dayOfMonth: recDayOfMonth } : {}),
      };
      if (recUntil) {
        const u = new Date(recUntil);
        if (!Number.isNaN(u.getTime())) {
          recurrenceRule.until = u.toISOString();
        }
      }
      if (recMaxCount) {
        const n = Number(recMaxCount);
        if (Number.isFinite(n) && n >= 1) {
          recurrenceRule.maxCount = Math.floor(n);
        }
      }
    }

    create.mutate({
      title: title.trim() || undefined,
      content: content.trim(),
      targetPlatforms: platforms as ("reddit" | "twitter" | "instagram")[],
      scheduleAt: date,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      mediaUrls: [],
      platformConfigs,
      recurrenceRule,
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
          <div className="mb-3 space-y-2 rounded-md border border-gray-800 bg-gray-950/40 p-3">
            <label className="block">
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

            <div>
              <span className="mb-1 block text-xs font-medium text-gray-400">
                Tipo de post
              </span>
              <div className="flex gap-1">
                {(["self", "link", "image"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setRedditKind(k)}
                    className={cn(
                      "flex-1 rounded-md border px-2 py-1 text-xs transition",
                      redditKind === k
                        ? "border-indigo-500 bg-indigo-500/20 text-white"
                        : "border-gray-700 bg-gray-800 text-gray-400 hover:text-white"
                    )}
                  >
                    {k === "self"
                      ? "Texto"
                      : k === "link"
                      ? "Enlace"
                      : "Imagen"}
                  </button>
                ))}
              </div>
            </div>

            {(redditKind === "link" || redditKind === "image") && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-400">
                  {redditKind === "link" ? "URL del enlace" : "URL de la imagen pública"}
                </span>
                <input
                  value={redditUrl}
                  onChange={(e) => setRedditUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                />
                {redditKind === "image" && (
                  <span className="mt-1 block text-xs text-gray-500">
                    La URL debe ser pública (i.imgur, redd.it, S3...). Reddit la
                    rechaza si no es accesible.
                  </span>
                )}
              </label>
            )}
          </div>
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

        <div className="mb-4 rounded-md border border-gray-800 bg-gray-950/40 p-3">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={recurring}
              onChange={(e) => setRecurring(e.target.checked)}
              className="h-4 w-4 rounded border-gray-700 bg-gray-800 text-indigo-500 focus:ring-indigo-500"
            />
            <span className="text-xs font-medium text-gray-300">
              Repetir publicación
            </span>
          </label>

          {recurring && (
            <div className="mt-3 space-y-2">
              <div className="flex gap-1">
                {(["daily", "weekly", "monthly"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setRecFrequency(f)}
                    className={cn(
                      "flex-1 rounded-md border px-2 py-1 text-xs",
                      recFrequency === f
                        ? "border-indigo-500 bg-indigo-500/20 text-white"
                        : "border-gray-700 bg-gray-800 text-gray-400 hover:text-white"
                    )}
                  >
                    {f === "daily" ? "Diario" : f === "weekly" ? "Semanal" : "Mensual"}
                  </button>
                ))}
              </div>

              {recFrequency === "weekly" && (
                <select
                  value={recDayOfWeek}
                  onChange={(e) => setRecDayOfWeek(Number(e.target.value))}
                  className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
                >
                  <option value={1}>Lunes</option>
                  <option value={2}>Martes</option>
                  <option value={3}>Miércoles</option>
                  <option value={4}>Jueves</option>
                  <option value={5}>Viernes</option>
                  <option value={6}>Sábado</option>
                  <option value={0}>Domingo</option>
                </select>
              )}

              {recFrequency === "monthly" && (
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={recDayOfMonth}
                  onChange={(e) => setRecDayOfMonth(Number(e.target.value))}
                  className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
                  placeholder="Día del mes (1-28)"
                />
              )}

              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={recHour}
                  onChange={(e) => setRecHour(Number(e.target.value))}
                  className="w-20 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
                  placeholder="Hora"
                />
                <span className="self-center text-xs text-gray-500">:</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={recMinute}
                  onChange={(e) => setRecMinute(Number(e.target.value))}
                  className="w-20 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
                  placeholder="Min"
                />
                <span className="self-center text-xs text-gray-500">UTC</span>
              </div>

              <div className="flex gap-2">
                <input
                  type="datetime-local"
                  value={recUntil}
                  onChange={(e) => setRecUntil(e.target.value)}
                  className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
                  placeholder="Hasta..."
                />
                <input
                  type="number"
                  min={1}
                  value={recMaxCount}
                  onChange={(e) => setRecMaxCount(e.target.value)}
                  className="w-24 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white"
                  placeholder="Nº veces"
                />
              </div>
              <span className="block text-xs text-gray-500">
                Sin fecha ni nº de veces, la serie se repite indefinidamente.
              </span>
            </div>
          )}
        </div>

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
