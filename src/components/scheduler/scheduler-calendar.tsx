"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type CalendarPost = {
  id: string;
  title: string | null;
  content: string;
  scheduleAt: string | Date;
  status: string;
  targetPlatforms: string[];
  isRecurring?: boolean;
};

type Props = {
  posts: CalendarPost[];
  onSelectPost: (id: string) => void;
  onSelectDay?: (date: Date) => void;
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-500/30 text-blue-200 border-blue-500/40",
  processing: "bg-amber-500/30 text-amber-200 border-amber-500/40",
  posted: "bg-emerald-500/30 text-emerald-200 border-emerald-500/40",
  partial: "bg-orange-500/30 text-orange-200 border-orange-500/40",
  failed: "bg-red-500/30 text-red-200 border-red-500/40",
  cancelled: "bg-gray-700/40 text-gray-400 border-gray-600/40",
};

const PLATFORM_ICONS: Record<string, string> = {
  reddit: "👽",
  twitter: "🐦",
  instagram: "📷",
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

export function SchedulerCalendar({ posts, onSelectPost, onSelectDay }: Props) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const grid = useMemo(() => buildGrid(cursor), [cursor]);

  const postsByDay = useMemo(() => {
    const map = new Map<string, CalendarPost[]>();
    for (const p of posts) {
      const d = new Date(p.scheduleAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    return map;
  }, [posts]);

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

  function shift(delta: number) {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40">
      <div className="flex items-center justify-between border-b border-gray-800 p-3">
        <h3 className="text-sm font-semibold text-white">
          {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
        </h3>
        <div className="flex gap-1">
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
          const dayPosts = postsByDay.get(key) ?? [];
          const isToday = key === todayKey;
          return (
            <button
              key={key}
              onClick={() => onSelectDay?.(cell.date)}
              className={cn(
                "min-h-[88px] border-b border-r border-gray-800 p-1 text-left align-top transition hover:bg-gray-800/40",
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
                {dayPosts.length > 0 && (
                  <span className="text-xs text-gray-500">{dayPosts.length}</span>
                )}
              </div>
              <div className="space-y-0.5">
                {dayPosts.slice(0, 3).map((p) => {
                  const time = new Date(p.scheduleAt).toLocaleTimeString("es-ES", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  return (
                    <div
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectPost(p.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.stopPropagation();
                          onSelectPost(p.id);
                        }
                      }}
                      className={cn(
                        "truncate rounded border px-1 py-0.5 text-xs hover:opacity-80",
                        STATUS_COLORS[p.status] ?? STATUS_COLORS.scheduled
                      )}
                      title={`${time} • ${p.title ?? p.content.slice(0, 60)}`}
                    >
                      <span className="mr-1">
                        {p.targetPlatforms
                          .map((t) => PLATFORM_ICONS[t] ?? "🌐")
                          .join("")}
                      </span>
                      {p.isRecurring && <span className="mr-0.5">↻</span>}
                      <span>{time}</span>{" "}
                      <span>{p.title ?? p.content.slice(0, 30)}</span>
                    </div>
                  );
                })}
                {dayPosts.length > 3 && (
                  <div className="text-xs text-gray-500">
                    +{dayPosts.length - 3} más
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function buildGrid(cursor: Date): { date: Date; inMonth: boolean }[] {
  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  // Monday as first day (0 = Mon, 6 = Sun)
  const dayOfWeek = (firstOfMonth.getDay() + 6) % 7;
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
