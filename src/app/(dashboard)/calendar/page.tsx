"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const PLATFORM_ICONS: Record<string, string> = {
  reddit: "👽",
  twitter: "🐦",
  instagram: "📷",
  onlyfans: "🌶️",
  telegram: "✈️",
  tinder: "🔥",
  snapchat: "👻",
  other: "🌐",
};

const STATUS_BADGE: Record<string, string> = {
  scheduled: "bg-blue-500/30 text-blue-200 border-blue-500/40",
  pending: "bg-blue-500/30 text-blue-200 border-blue-500/40",
  processing: "bg-amber-500/30 text-amber-200 border-amber-500/40",
  posted: "bg-emerald-500/30 text-emerald-200 border-emerald-500/40",
  sent: "bg-emerald-500/30 text-emerald-200 border-emerald-500/40",
  partial: "bg-orange-500/30 text-orange-200 border-orange-500/40",
  failed: "bg-red-500/30 text-red-200 border-red-500/40",
  cancelled: "bg-gray-700/40 text-gray-400 border-gray-600/40",
};

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

type CalendarEvent =
  | {
      type: "post";
      id: string;
      date: string | Date;
      title: string | null;
      content: string;
      status: string;
      platforms: string[];
      isRecurring: boolean;
    }
  | {
      type: "message";
      id: string;
      date: string | Date;
      title: string | null;
      content: string;
      status: string;
      platforms: string[];
      contactName: string | null;
    };

type Filter = { posts: boolean; messages: boolean };

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [filter, setFilter] = useState<Filter>({ posts: true, messages: true });

  const events = trpc.intelligence.unifiedCalendar.useQuery({
    year: cursor.getFullYear(),
    month: cursor.getMonth(),
  });

  const grid = useMemo(() => buildGrid(cursor), [cursor]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of (events.data ?? []) as CalendarEvent[]) {
      if (!filter.posts && e.type === "post") continue;
      if (!filter.messages && e.type === "message") continue;
      const d = new Date(e.date);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return map;
  }, [events.data, filter]);

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

  function shift(delta: number) {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Calendario global</h1>
          <p className="text-sm text-gray-400">
            Posts programados y mensajes diferidos en una sola vista.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/scheduler"
            className="rounded-md bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-700"
          >
            📅 Scheduler
          </Link>
          <Link
            href="/scheduled"
            className="rounded-md bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-700"
          >
            💬 Mensajes
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
        <h2 className="text-sm font-semibold text-white">
          {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() =>
              setFilter((f) => ({ ...f, posts: !f.posts }))
            }
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium",
              filter.posts
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-gray-800 text-gray-500"
            )}
          >
            📅 Posts
          </button>
          <button
            onClick={() =>
              setFilter((f) => ({ ...f, messages: !f.messages }))
            }
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium",
              filter.messages
                ? "bg-blue-500/20 text-blue-300"
                : "bg-gray-800 text-gray-500"
            )}
          >
            💬 Mensajes
          </button>
          <div className="ml-2 flex gap-1">
            <button
              onClick={() => shift(-1)}
              className="rounded-md bg-gray-800 px-3 py-1 text-xs text-gray-200 hover:bg-gray-700"
            >
              ←
            </button>
            <button
              onClick={() =>
                setCursor(new Date(today.getFullYear(), today.getMonth(), 1))
              }
              className="rounded-md bg-gray-800 px-3 py-1 text-xs text-gray-200 hover:bg-gray-700"
            >
              Hoy
            </button>
            <button
              onClick={() => shift(1)}
              className="rounded-md bg-gray-800 px-3 py-1 text-xs text-gray-200 hover:bg-gray-700"
            >
              →
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900/40">
        <div className="grid grid-cols-7 border-b border-gray-800 text-xs text-gray-500">
          {WEEKDAYS.map((d) => (
            <div key={d} className="p-2 text-center">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {grid.map((cell) => {
            const key = `${cell.date.getFullYear()}-${cell.date.getMonth()}-${cell.date.getDate()}`;
            const dayEvents = eventsByDay.get(key) ?? [];
            const isToday = key === todayKey;
            return (
              <div
                key={key}
                className={cn(
                  "min-h-[100px] border-b border-r border-gray-800 p-1.5 align-top",
                  !cell.inMonth && "bg-gray-950/40 text-gray-600"
                )}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={cn(
                      "inline-block rounded-full px-1.5 text-xs",
                      isToday
                        ? "bg-indigo-600 text-white"
                        : cell.inMonth
                        ? "text-gray-300"
                        : "text-gray-600"
                    )}
                  >
                    {cell.date.getDate()}
                  </span>
                  {dayEvents.length > 0 && (
                    <span className="text-xs text-gray-500">
                      {dayEvents.length}
                    </span>
                  )}
                </div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 3).map((e) => {
                    const time = new Date(e.date).toLocaleTimeString("es-ES", {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    const platforms = e.platforms
                      .map((p) => PLATFORM_ICONS[p] ?? "🌐")
                      .join("");
                    const isPost = e.type === "post";
                    const titleText =
                      e.title ?? (e.content?.slice(0, 30) || "");
                    return (
                      <Link
                        key={`${e.type}-${e.id}`}
                        href={
                          isPost
                            ? "/scheduler"
                            : "/scheduled"
                        }
                        className={cn(
                          "block truncate rounded border px-1 py-0.5 text-xs hover:opacity-80",
                          STATUS_BADGE[e.status] ?? STATUS_BADGE.scheduled
                        )}
                        title={`${time} • ${
                          isPost ? "Post" : "Mensaje"
                        } • ${titleText}`}
                      >
                        <span className="mr-0.5">{isPost ? "📅" : "💬"}</span>
                        {platforms && <span className="mr-0.5">{platforms}</span>}
                        {isPost && (e as { isRecurring?: boolean }).isRecurring && (
                          <span className="mr-0.5">↻</span>
                        )}
                        <span>{time}</span> <span>{titleText}</span>
                      </Link>
                    );
                  })}
                  {dayEvents.length > 3 && (
                    <div className="text-xs text-gray-500">
                      +{dayEvents.length - 3} más
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {events.isLoading && (
        <p className="text-center text-xs text-gray-500">Cargando eventos...</p>
      )}
    </div>
  );
}

function buildGrid(cursor: Date): { date: Date; inMonth: boolean }[] {
  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const dayOfWeek = (firstOfMonth.getDay() + 6) % 7; // Mon = 0
  const start = new Date(firstOfMonth);
  start.setDate(start.getDate() - dayOfWeek);

  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({
      date: d,
      inMonth: d.getMonth() === cursor.getMonth(),
    });
  }
  return cells;
}
