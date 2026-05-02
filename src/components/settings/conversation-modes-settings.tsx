"use client";

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { ABExperimentsSettings } from "@/components/settings/ab-experiments-settings";

type ModeType = "BASE" | "POTENCIAL_PREMIUM" | "CONVERSION" | "VIP" | "LOW_VALUE";

type ModeForm = {
  modeType: ModeType;
  name: string;
  description: string;
  tone: string;
  style: string;
  messageLength: "short" | "medium" | "long";
  objectives: string[];
  restrictions: string[];
  additionalInstructions: string;
  priority: number;
  isActive: boolean;
};

const MODE_LABELS: Record<ModeType, { label: string; color: string }> = {
  BASE: { label: "Base / Observacion", color: "bg-gray-500" },
  POTENCIAL_PREMIUM: { label: "Potencial Premium", color: "bg-blue-500" },
  CONVERSION: { label: "Conversion / Ritual", color: "bg-yellow-500" },
  VIP: { label: "Alto Valor / VIP", color: "bg-purple-500" },
  LOW_VALUE: { label: "Bajo Valor / Descarte", color: "bg-red-500" },
};

const MODE_ORDER: ModeType[] = ["BASE", "POTENCIAL_PREMIUM", "CONVERSION", "VIP", "LOW_VALUE"];

export function ConversationModesSettings() {
  const [editingMode, setEditingMode] = useState<ModeType | null>(null);
  const [form, setForm] = useState<ModeForm | null>(null);
  const [saved, setSaved] = useState(false);
  const [objectiveInput, setObjectiveInput] = useState("");
  const [restrictionInput, setRestrictionInput] = useState("");

  const query = trpc.conversationModes.list.useQuery();
  const upsertMutation = trpc.conversationModes.upsert.useMutation({
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      query.refetch();
      setEditingMode(null);
      setForm(null);
    },
  });
  const toggleMutation = trpc.conversationModes.toggleActive.useMutation({
    onSuccess: () => query.refetch(),
  });
  const initMutation = trpc.conversationModes.initDefaults.useMutation({
    onSuccess: () => query.refetch(),
  });

  const modes = query.data ?? [];
  const isDefaults = modes.length > 0 && (modes[0] as { isDefault?: boolean }).isDefault === true;

  function startEdit(modeType: ModeType) {
    const mode = modes.find((m) => m.modeType === modeType);
    if (!mode) return;
    setForm({
      modeType: mode.modeType as ModeType,
      name: mode.name,
      description: mode.description ?? "",
      tone: mode.tone ?? "",
      style: mode.style ?? "",
      messageLength: (mode.messageLength as "short" | "medium" | "long") ?? "medium",
      objectives: (mode.objectives as string[]) ?? [],
      restrictions: (mode.restrictions as string[]) ?? [],
      additionalInstructions: mode.additionalInstructions ?? "",
      priority: mode.priority,
      isActive: mode.isActive,
    });
    setEditingMode(modeType);
    setObjectiveInput("");
    setRestrictionInput("");
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;

    const payload = {
      modeType: form.modeType as "BASE" | "POTENCIAL_PREMIUM" | "CONVERSION" | "VIP" | "LOW_VALUE",
      name: form.name,
      description: form.description || null,
      tone: form.tone || null,
      style: form.style || null,
      messageLength: form.messageLength as "short" | "medium" | "long" | null,
      objectives: form.objectives,
      restrictions: form.restrictions,
      additionalInstructions: form.additionalInstructions || null,
      activationCriteria: {},
      priority: form.priority,
      isActive: form.isActive,
    };

    // If using defaults, init them in DB first
    if (isDefaults) {
      initMutation.mutate(undefined, {
        onSuccess: () => {
          upsertMutation.mutate(payload);
        },
      });
      return;
    }

    upsertMutation.mutate(payload);
  }

  function addObjective() {
    if (!form || !objectiveInput.trim()) return;
    setForm({ ...form, objectives: [...form.objectives, objectiveInput.trim()] });
    setObjectiveInput("");
  }

  function removeObjective(idx: number) {
    if (!form) return;
    setForm({ ...form, objectives: form.objectives.filter((_, i) => i !== idx) });
  }

  function addRestriction() {
    if (!form || !restrictionInput.trim()) return;
    setForm({ ...form, restrictions: [...form.restrictions, restrictionInput.trim()] });
    setRestrictionInput("");
  }

  function removeRestriction(idx: number) {
    if (!form) return;
    setForm({ ...form, restrictions: form.restrictions.filter((_, i) => i !== idx) });
  }

  if (query.isLoading) {
    return <div className="text-sm text-gray-400">Cargando modos...</div>;
  }

  if (query.isError) {
    return (
      <div className="text-sm text-red-400">
        Error al cargar los modos: {query.error.message}
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-1 text-base font-semibold text-white">
        Modos de conversacion (OnlyFans)
      </h3>
      <p className="mb-6 text-sm text-gray-400">
        Configura como la IA adapta su tono y estilo segun el perfil del fan.
        Cada modo se activa automaticamente basandose en el scoring del contacto.
      </p>

      {isDefaults && (
        <div className="mb-4 rounded-lg border border-yellow-600/30 bg-yellow-900/20 px-4 py-3 text-sm text-yellow-300">
          Estas usando los modos por defecto. Al editar cualquier modo se guardaran todos en tu cuenta.
        </div>
      )}

      {/* Mode list */}
      {editingMode === null && (
        <div className="max-w-2xl space-y-3">
          {MODE_ORDER.map((modeType) => {
            const mode = modes.find((m) => m.modeType === modeType);
            if (!mode) return null;
            const info = MODE_LABELS[modeType];
            return (
              <div
                key={modeType}
                className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${info.color}`} />
                  <div>
                    <div className="text-sm font-medium text-white">{mode.name}</div>
                    <div className="text-xs text-gray-400">{mode.description}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if ((mode as { isDefault?: boolean }).isDefault) return;
                      toggleMutation.mutate({ modeType, isActive: !mode.isActive });
                    }}
                    disabled={modeType === "BASE" || (mode as { isDefault?: boolean }).isDefault}
                    className={`rounded px-2 py-1 text-xs font-medium ${
                      mode.isActive
                        ? "bg-green-900/50 text-green-400"
                        : "bg-gray-700 text-gray-400"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {mode.isActive ? "Activo" : "Inactivo"}
                  </button>
                  <button
                    onClick={() => startEdit(modeType)}
                    className="rounded px-3 py-1 text-xs font-medium text-indigo-400 hover:bg-indigo-900/30"
                  >
                    Editar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit form */}
      {editingMode !== null && form && (
        <form onSubmit={handleSave} className="max-w-2xl space-y-4">
          <div className="flex items-center gap-2 border-b border-gray-700 pb-3">
            <span className={`h-3 w-3 rounded-full ${MODE_LABELS[editingMode].color}`} />
            <h4 className="text-sm font-semibold text-white">
              Editando: {MODE_LABELS[editingMode].label}
            </h4>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm text-gray-300">Nombre</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-300">Longitud mensajes</label>
              <select
                value={form.messageLength}
                onChange={(e) =>
                  setForm({ ...form, messageLength: e.target.value as "short" | "medium" | "long" })
                }
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              >
                <option value="short">Corto</option>
                <option value="medium">Medio</option>
                <option value="long">Largo</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-300">Descripcion</label>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm text-gray-300">Tono</label>
              <input
                value={form.tone}
                onChange={(e) => setForm({ ...form, tone: e.target.value })}
                placeholder="ej: dulce, selectiva"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-300">Estilo</label>
              <input
                value={form.style}
                onChange={(e) => setForm({ ...form, style: e.target.value })}
                placeholder="ej: coqueta, misteriosa"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Objectives */}
          <div>
            <label className="mb-1 block text-sm text-gray-300">Objetivos</label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {form.objectives.map((obj, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1 rounded-full bg-indigo-900/40 px-2.5 py-1 text-xs text-indigo-300"
                >
                  {obj}
                  <button type="button" onClick={() => removeObjective(i)} className="text-indigo-400 hover:text-white">
                    x
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={objectiveInput}
                onChange={(e) => setObjectiveInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addObjective(); } }}
                placeholder="Nuevo objetivo..."
                className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
              <button type="button" onClick={addObjective} className="rounded-lg bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600">
                Anadir
              </button>
            </div>
          </div>

          {/* Restrictions */}
          <div>
            <label className="mb-1 block text-sm text-gray-300">Restricciones</label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {form.restrictions.map((r, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1 rounded-full bg-red-900/40 px-2.5 py-1 text-xs text-red-300"
                >
                  {r}
                  <button type="button" onClick={() => removeRestriction(i)} className="text-red-400 hover:text-white">
                    x
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={restrictionInput}
                onChange={(e) => setRestrictionInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRestriction(); } }}
                placeholder="Nueva restriccion..."
                className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
              <button type="button" onClick={addRestriction} className="rounded-lg bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600">
                Anadir
              </button>
            </div>
          </div>

          {/* Additional instructions */}
          <div>
            <label className="mb-1 block text-sm text-gray-300">Instrucciones adicionales</label>
            <textarea
              value={form.additionalInstructions}
              onChange={(e) => setForm({ ...form, additionalInstructions: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={upsertMutation.isPending || initMutation.isPending}
              className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {upsertMutation.isPending ? "Guardando..." : "Guardar"}
            </button>
            <button
              type="button"
              onClick={() => { setEditingMode(null); setForm(null); }}
              className="rounded-lg bg-gray-700 px-4 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-600"
            >
              Cancelar
            </button>
            {saved && <span className="text-sm text-green-400">Guardado</span>}
          </div>
        </form>
      )}

      {/* A/B Experiments section */}
      <div className="mt-10 border-t border-gray-800 pt-8">
        <ABExperimentsSettings />
      </div>
    </div>
  );
}
