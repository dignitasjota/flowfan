"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onInsert: (next: string) => void;
  vars: Record<string, string>;
  /** When provided, restrict templates to this platform's templates plus generic ones */
  platformType?: string;
};

function interpolate(content: string, vars: Record<string, string>): string {
  return content.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    return vars[key] ?? `{{${key}}}`;
  });
}

/**
 * Detect if the current cursor position is inside a slash command.
 * A slash command is "/word" anchored to the start of the input or after
 * whitespace/newline. Returns the slash range and the typed query.
 */
function detectSlashCommand(
  text: string,
  cursor: number
): { start: number; end: number; query: string } | null {
  // Walk backwards from cursor to find a "/" preceded by start/whitespace
  let start = -1;
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "/") {
      const before = i === 0 ? " " : text[i - 1];
      if (before === " " || before === "\n" || before === "\t" || i === 0) {
        start = i;
      }
      break;
    }
    if (ch === " " || ch === "\n" || ch === "\t") return null;
  }
  if (start < 0) return null;

  // Extend forward through the word until cursor
  const query = text.slice(start + 1, cursor);
  if (!/^[a-zA-Z0-9_-]*$/.test(query)) return null;

  return { start, end: cursor, query };
}

export function SlashTemplateMenu({
  value,
  inputRef,
  onInsert,
  vars,
  platformType,
}: Props) {
  const templates = trpc.templates.list.useQuery({
    platformType,
  });
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const cursor = inputRef.current?.selectionStart ?? value.length;
  const slash = detectSlashCommand(value, cursor);

  const filtered = useMemo(() => {
    if (!slash || !templates.data) return [];
    const q = slash.query.toLowerCase();
    return templates.data
      .filter((t) => {
        if (!q) return true;
        return (
          t.name.toLowerCase().includes(q) ||
          (t.category?.toLowerCase().includes(q) ?? false)
        );
      })
      .slice(0, 8);
  }, [slash, templates.data]);

  // Reset highlight when slash query changes
  useEffect(() => {
    setHighlight(0);
  }, [slash?.query]);

  // Capture keyboard navigation while the menu is open
  useEffect(() => {
    const node = inputRef.current;
    if (!node || !slash || filtered.length === 0) return;

    function onKeyDown(e: KeyboardEvent) {
      if (!slash || filtered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        applyTemplate(filtered[highlight]);
      } else if (e.key === "Tab") {
        e.preventDefault();
        applyTemplate(filtered[highlight]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        // Replace the slash range with empty so the menu closes
        const next = value.slice(0, slash.start) + value.slice(slash.end);
        onInsert(next);
      }
    }

    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slash?.query, filtered, highlight, value]);

  function applyTemplate(template: { content: string } | undefined) {
    if (!slash || !template) return;
    const interpolated = interpolate(template.content, vars);
    const next =
      value.slice(0, slash.start) + interpolated + value.slice(slash.end);
    onInsert(next);
  }

  if (!slash || filtered.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 z-30 mb-1 w-80 max-w-full overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-xl"
    >
      <div className="border-b border-gray-800 px-3 py-1.5 text-[11px] uppercase tracking-wider text-gray-500">
        Templates · {filtered.length}
      </div>
      <ul className="max-h-64 overflow-y-auto py-1">
        {filtered.map((t, i) => (
          <li key={t.id}>
            <button
              type="button"
              onMouseDown={(e) => {
                // Use mousedown so click fires before textarea blur dismisses
                e.preventDefault();
                applyTemplate(t);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                "block w-full px-3 py-2 text-left transition",
                i === highlight ? "bg-indigo-600/30" : "hover:bg-gray-800"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">{t.name}</span>
                {t.category && (
                  <span className="rounded-full bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">
                    {t.category}
                  </span>
                )}
              </div>
              <div className="mt-0.5 line-clamp-1 text-xs text-gray-400">
                {t.content}
              </div>
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-gray-800 px-3 py-1.5 text-[10px] text-gray-500">
        ↑↓ navegar · Enter/Tab insertar · Esc cerrar
      </div>
    </div>
  );
}
