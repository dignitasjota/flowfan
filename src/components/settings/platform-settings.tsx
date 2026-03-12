"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";

const platformOptions = [
  { value: "instagram", label: "Instagram" },
  { value: "tinder", label: "Tinder" },
  { value: "reddit", label: "Reddit" },
  { value: "onlyfans", label: "OnlyFans" },
  { value: "twitter", label: "Twitter" },
  { value: "telegram", label: "Telegram" },
  { value: "snapchat", label: "Snapchat" },
  { value: "other", label: "Otra" },
] as const;

type PlatformType = (typeof platformOptions)[number]["value"];

export function PlatformSettings() {
  const [selectedPlatform, setSelectedPlatform] =
    useState<PlatformType>("instagram");
  const [tone, setTone] = useState("");
  const [style, setStyle] = useState("");
  const [messageLength, setMessageLength] = useState<
    "short" | "medium" | "long"
  >("medium");
  const [goals, setGoals] = useState("");
  const [restrictions, setRestrictions] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [saved, setSaved] = useState(false);

  const platformsQuery = trpc.platforms.list.useQuery(undefined, {
    onSuccess: (data) => {
      loadPlatformConfig(selectedPlatform, data);
    },
  });

  const upsertPlatform = trpc.platforms.upsert.useMutation({
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      platformsQuery.refetch();
    },
  });

  function loadPlatformConfig(
    platform: PlatformType,
    data?: typeof platformsQuery.data
  ) {
    const platforms = data ?? platformsQuery.data;
    const existing = platforms?.find((p) => p.platformType === platform);
    const config = (existing?.personalityConfig ?? {}) as Record<
      string,
      unknown
    >;

    setTone((config.tone as string) ?? "");
    setStyle((config.style as string) ?? "");
    setMessageLength(
      (config.messageLength as "short" | "medium" | "long") ?? "medium"
    );
    setGoals(((config.goals as string[]) ?? []).join(", "));
    setRestrictions(((config.restrictions as string[]) ?? []).join(", "));
    setCustomInstructions((config.customInstructions as string) ?? "");
  }

  function handlePlatformChange(platform: PlatformType) {
    setSelectedPlatform(platform);
    loadPlatformConfig(platform);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    upsertPlatform.mutate({
      platformType: selectedPlatform,
      personalityConfig: {
        tone,
        style,
        messageLength,
        goals: goals
          .split(",")
          .map((g) => g.trim())
          .filter(Boolean),
        restrictions: restrictions
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean),
        customInstructions,
      },
    });
  }

  return (
    <div>
      <h3 className="mb-1 text-base font-semibold text-white">
        Personalidad por plataforma
      </h3>
      <p className="mb-6 text-sm text-gray-400">
        Configura cómo quieres que la IA responda en cada red social
      </p>

      {/* Platform selector */}
      <div className="mb-6 flex flex-wrap gap-2">
        {platformOptions.map((p) => (
          <button
            key={p.value}
            onClick={() => handlePlatformChange(p.value)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              selectedPlatform === p.value
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Config form */}
      <form onSubmit={handleSave} className="max-w-2xl space-y-5">
        <div>
          <label className="mb-1 block text-sm text-gray-300">Tono</label>
          <input
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            placeholder="ej: dulce, tímido, directo, casual..."
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-gray-300">Estilo</label>
          <input
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="ej: coqueto, profesional, misterioso..."
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-gray-300">
            Longitud de mensajes
          </label>
          <select
            value={messageLength}
            onChange={(e) =>
              setMessageLength(e.target.value as "short" | "medium" | "long")
            }
            className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
          >
            <option value="short">Cortos</option>
            <option value="medium">Medios</option>
            <option value="long">Largos</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm text-gray-300">
            Objetivos (separados por comas)
          </label>
          <input
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            placeholder="ej: monetizar, fidelizar, crear confianza..."
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-gray-300">
            Restricciones (separadas por comas)
          </label>
          <input
            value={restrictions}
            onChange={(e) => setRestrictions(e.target.value)}
            placeholder="ej: no vender directamente, no dar datos personales..."
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-gray-300">
            Instrucciones adicionales
          </label>
          <textarea
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            rows={4}
            placeholder="Cualquier instrucción adicional para la IA..."
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={upsertPlatform.isPending}
            className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {upsertPlatform.isPending ? "Guardando..." : "Guardar"}
          </button>
          {saved && <span className="text-sm text-green-400">Guardado</span>}
        </div>
      </form>
    </div>
  );
}
