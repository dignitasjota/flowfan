"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { PLATFORM_OPTIONS } from "@/lib/constants";

const toneOptions = ["Amigable", "Profesional", "Coqueto", "Casual", "Directo"];

type Props = {
  onComplete: () => void;
};

export function StepPlatform({ onComplete }: Props) {
  const [platform, setPlatform] = useState<string>("");
  const [tone, setTone] = useState("");
  const [style, setStyle] = useState("");
  const upsertMutation = trpc.platforms.upsert.useMutation();

  async function handleSave() {
    if (!platform) return;

    await upsertMutation.mutateAsync({
      platformType: platform as any,
      personalityConfig: {
        tone: tone || "friendly",
        style: style || undefined,
      },
      isActive: true,
    });
    onComplete();
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white">
          Elige tu plataforma principal
        </h3>
        <p className="mt-1 text-sm text-gray-400">
          Podras añadir mas plataformas despues.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PLATFORM_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setPlatform(opt.value)}
            className={cn(
              "rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
              platform === opt.value
                ? "border-indigo-500 bg-indigo-500/10 text-indigo-400"
                : "border-gray-700 text-gray-400 hover:border-gray-600 hover:text-white"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {platform && (
        <>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">
              Tono de respuestas
            </label>
            <div className="flex flex-wrap gap-2">
              {toneOptions.map((t) => (
                <button
                  key={t}
                  onClick={() => setTone(t.toLowerCase())}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    tone === t.toLowerCase()
                      ? "border-indigo-500 bg-indigo-500/10 text-indigo-400"
                      : "border-gray-700 text-gray-400 hover:border-gray-600"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">
              Estilo adicional (opcional)
            </label>
            <input
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder="Ej: usa emojis, respuestas cortas, mezcla ingles y español..."
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </>
      )}

      <button
        onClick={handleSave}
        disabled={!platform || upsertMutation.isPending}
        className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {upsertMutation.isPending ? "Guardando..." : "Siguiente"}
      </button>
    </div>
  );
}
