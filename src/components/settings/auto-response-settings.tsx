"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "tinder", label: "Tinder" },
  { value: "reddit", label: "Reddit" },
  { value: "onlyfans", label: "OnlyFans" },
  { value: "twitter", label: "Twitter" },
  { value: "telegram", label: "Telegram" },
  { value: "snapchat", label: "Snapchat" },
  { value: "other", label: "Otro" },
] as const;

type PlatformType = (typeof PLATFORMS)[number]["value"];

type ConfigFormState = {
  isEnabled: boolean;
  inactivityMinutes: number;
  useAIReply: boolean;
  maxTokens: number;
  fallbackMessage: string;
  classifyMessages: boolean;
  preGenerateReplies: boolean;
};

const DEFAULT_CONFIG: ConfigFormState = {
  isEnabled: false,
  inactivityMinutes: 30,
  useAIReply: false,
  maxTokens: 256,
  fallbackMessage: "",
  classifyMessages: true,
  preGenerateReplies: true,
};

export function AutoResponseSettings() {
  const [expandedPlatform, setExpandedPlatform] = useState<PlatformType | null>(null);
  const configs = trpc.autoResponse.getConfigs.useQuery();
  const classificationStats = trpc.autoResponse.getClassificationStats.useQuery();
  const upsert = trpc.autoResponse.upsertConfig.useMutation({
    onSuccess: () => configs.refetch(),
  });

  function getConfig(platform: PlatformType): ConfigFormState {
    const existing = configs.data?.find((c) => c.platformType === platform);
    if (!existing) return DEFAULT_CONFIG;
    return {
      isEnabled: existing.isEnabled,
      inactivityMinutes: existing.inactivityMinutes,
      useAIReply: existing.useAIReply,
      maxTokens: existing.maxTokens,
      fallbackMessage: existing.fallbackMessage ?? "",
      classifyMessages: existing.classifyMessages,
      preGenerateReplies: existing.preGenerateReplies,
    };
  }

  function handleSave(platform: PlatformType, config: ConfigFormState) {
    upsert.mutate({
      platformType: platform,
      isEnabled: config.isEnabled,
      inactivityMinutes: config.inactivityMinutes,
      useAIReply: config.useAIReply,
      maxTokens: config.maxTokens,
      fallbackMessage: config.fallbackMessage || null,
      classifyMessages: config.classifyMessages,
      preGenerateReplies: config.preGenerateReplies,
    });
  }

  function handleToggle(platform: PlatformType) {
    const current = getConfig(platform);
    handleSave(platform, { ...current, isEnabled: !current.isEnabled });
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-white">Auto-Respuestas</h3>
        <p className="mt-1 text-sm text-gray-400">
          Configura respuestas automaticas por plataforma, clasificacion de mensajes y respuestas rapidas pre-generadas.
        </p>
      </div>

      {/* Classification Stats */}
      {classificationStats.data && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
          <h4 className="mb-3 text-sm font-medium text-gray-400">Clasificacion de mensajes (30 dias)</h4>
          <div className="grid grid-cols-4 gap-3">
            {Object.entries(classificationStats.data).map(([category, count]) => (
              <div key={category} className="rounded-lg bg-gray-800 p-3 text-center">
                <p className="text-lg font-bold text-white">{count}</p>
                <p
                  className={cn(
                    "text-xs",
                    category === "urgent"
                      ? "text-red-400"
                      : category === "price_inquiry"
                        ? "text-green-400"
                        : category === "spam"
                          ? "text-gray-400"
                          : "text-blue-400"
                  )}
                >
                  {category === "urgent"
                    ? "Urgente"
                    : category === "price_inquiry"
                      ? "Precio"
                      : category === "spam"
                        ? "Spam"
                        : "General"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Platform configs */}
      <div className="space-y-2">
        {PLATFORMS.map((platform) => {
          const config = getConfig(platform.value);
          const isExpanded = expandedPlatform === platform.value;

          return (
            <PlatformConfigCard
              key={platform.value}
              platform={platform}
              config={config}
              isExpanded={isExpanded}
              isSaving={upsert.isPending}
              onToggle={() => handleToggle(platform.value)}
              onExpand={() =>
                setExpandedPlatform(isExpanded ? null : platform.value)
              }
              onSave={(c) => handleSave(platform.value, c)}
            />
          );
        })}
      </div>

      {/* Link to workflows */}
      <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
        <h4 className="mb-2 text-sm font-medium text-white">Reglas avanzadas</h4>
        <p className="mb-3 text-xs text-gray-400">
          Para crear reglas tipo &quot;Si el mensaje menciona precio → enviar template&quot;, usa el sistema de Workflows.
        </p>
        <a
          href="/workflows"
          className="inline-block rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
        >
          Ir a Workflows
        </a>
      </div>
    </div>
  );
}

function PlatformConfigCard({
  platform,
  config,
  isExpanded,
  isSaving,
  onToggle,
  onExpand,
  onSave,
}: {
  platform: { value: PlatformType; label: string };
  config: ConfigFormState;
  isExpanded: boolean;
  isSaving: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onSave: (config: ConfigFormState) => void;
}) {
  const [form, setForm] = useState(config);

  function updateForm(updates: Partial<ConfigFormState>) {
    setForm((prev) => ({ ...prev, ...updates }));
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={onExpand}
          className="flex items-center gap-3 text-left"
        >
          <span className="text-sm font-medium text-white">{platform.label}</span>
          <span className="text-xs text-gray-500">{isExpanded ? "▲" : "▼"}</span>
        </button>
        <button
          onClick={onToggle}
          className={cn(
            "relative h-6 w-11 rounded-full transition-colors",
            config.isEnabled ? "bg-indigo-600" : "bg-gray-700"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
              config.isEnabled ? "left-5" : "left-0.5"
            )}
          />
        </button>
      </div>

      {isExpanded && (
        <div className="border-t border-gray-800 px-4 py-4 space-y-4">
          <div>
            <label className="block text-xs text-gray-400">
              Tiempo de inactividad (minutos)
            </label>
            <input
              type="number"
              min={1}
              max={1440}
              value={form.inactivityMinutes}
              onChange={(e) =>
                updateForm({ inactivityMinutes: Number(e.target.value) || 30 })
              }
              className="mt-1 w-32 rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white"
            />
            <p className="mt-1 text-xs text-gray-500">
              Auto-responder si no respondes en este tiempo
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={form.useAIReply}
              onChange={(e) => updateForm({ useAIReply: e.target.checked })}
              className="rounded border-gray-600"
            />
            <label className="text-sm text-gray-300">Usar IA para auto-respuestas</label>
          </div>

          {form.useAIReply && (
            <div>
              <label className="block text-xs text-gray-400">
                Max tokens para respuesta IA
              </label>
              <input
                type="range"
                min={64}
                max={1024}
                step={64}
                value={form.maxTokens}
                onChange={(e) => updateForm({ maxTokens: Number(e.target.value) })}
                className="mt-1 w-full"
              />
              <span className="text-xs text-gray-500">{form.maxTokens} tokens</span>
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400">
              Mensaje fallback (si IA no disponible)
            </label>
            <textarea
              value={form.fallbackMessage}
              onChange={(e) => updateForm({ fallbackMessage: e.target.value })}
              rows={2}
              placeholder="Ej: Gracias por tu mensaje, te respondo pronto!"
              className="mt-1 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={form.classifyMessages}
              onChange={(e) => updateForm({ classifyMessages: e.target.checked })}
              className="rounded border-gray-600"
            />
            <label className="text-sm text-gray-300">Clasificar mensajes automaticamente</label>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={form.preGenerateReplies}
              onChange={(e) => updateForm({ preGenerateReplies: e.target.checked })}
              className="rounded border-gray-600"
            />
            <label className="text-sm text-gray-300">Pre-generar respuestas rapidas</label>
          </div>

          <button
            onClick={() => onSave(form)}
            disabled={isSaving}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {isSaving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      )}
    </div>
  );
}
