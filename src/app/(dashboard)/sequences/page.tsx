"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const typeLabels: Record<string, string> = {
  nurturing: "Nurturing",
  followup: "Follow-Up",
  custom: "Personalizada",
};

const typeColors: Record<string, string> = {
  nurturing: "bg-green-500/20 text-green-300",
  followup: "bg-blue-500/20 text-blue-300",
  custom: "bg-purple-500/20 text-purple-300",
};

type Step = {
  stepNumber: number;
  delayDays: number;
  actionType: string;
  actionConfig: Record<string, unknown>;
};

export default function SequencesPage() {
  const sequences = trpc.sequences.list.useQuery();
  const utils = trpc.useUtils();
  const toggleActive = trpc.sequences.toggleActive.useMutation({
    onSuccess: () => utils.sequences.list.invalidate(),
  });
  const createSequence = trpc.sequences.create.useMutation({
    onSuccess: () => {
      utils.sequences.list.invalidate();
      setShowCreate(false);
      resetForm();
    },
  });

  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"nurturing" | "followup" | "custom">("custom");
  const [steps, setSteps] = useState<Step[]>([
    { stepNumber: 0, delayDays: 1, actionType: "send_message", actionConfig: { content: "" } },
  ]);

  function resetForm() {
    setName("");
    setDescription("");
    setType("custom");
    setSteps([{ stepNumber: 0, delayDays: 1, actionType: "send_message", actionConfig: { content: "" } }]);
  }

  function addStep() {
    setSteps((prev) => [
      ...prev,
      { stepNumber: prev.length, delayDays: 3, actionType: "send_message", actionConfig: { content: "" } },
    ]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, stepNumber: i })));
  }

  function updateStep(index: number, field: string, value: unknown) {
    setSteps((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s;
        if (field === "content") return { ...s, actionConfig: { ...s.actionConfig, content: value } };
        return { ...s, [field]: value };
      })
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Secuencias</h1>
          <p className="text-sm text-gray-400">Automatiza mensajes de seguimiento y nurturing</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showCreate ? "Cancelar" : "Nueva Secuencia"}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs text-gray-400">Nombre</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                placeholder="Mi secuencia..."
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Tipo</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              >
                <option value="nurturing">Nurturing</option>
                <option value="followup">Follow-Up</option>
                <option value="custom">Personalizada</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">Descripcion</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              placeholder="Descripcion opcional..."
            />
          </div>

          {/* Steps */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Pasos</h3>
              <button onClick={addStep} className="text-xs text-blue-400 hover:text-blue-300">
                + Agregar paso
              </button>
            </div>
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg bg-gray-800/50 p-3">
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  {i + 1}
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2">
                    <div className="w-32">
                      <label className="mb-0.5 block text-[10px] text-gray-500">Delay (dias)</label>
                      <input
                        type="number"
                        min={0}
                        value={step.delayDays}
                        onChange={(e) => updateStep(i, "delayDays", Number(e.target.value))}
                        className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="mb-0.5 block text-[10px] text-gray-500">Accion</label>
                      <select
                        value={step.actionType}
                        onChange={(e) => updateStep(i, "actionType", e.target.value)}
                        className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white"
                      >
                        <option value="send_message">Enviar mensaje</option>
                        <option value="create_notification">Crear notificacion</option>
                      </select>
                    </div>
                  </div>
                  {step.actionType === "send_message" && (
                    <textarea
                      value={(step.actionConfig.content as string) ?? ""}
                      onChange={(e) => updateStep(i, "content", e.target.value)}
                      rows={2}
                      className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white"
                      placeholder="Contenido del mensaje... (usa {{displayName}}, {{username}})"
                    />
                  )}
                </div>
                {steps.length > 1 && (
                  <button onClick={() => removeStep(i)} className="text-gray-500 hover:text-red-400">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <button
              onClick={() =>
                createSequence.mutate({
                  name,
                  description: description || undefined,
                  type,
                  steps,
                })
              }
              disabled={!name || steps.some((s) => s.actionType === "send_message" && !s.actionConfig.content)}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              Crear Secuencia
            </button>
          </div>
        </div>
      )}

      {/* Sequence list */}
      {!sequences.data || sequences.data.length === 0 ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-8 text-center">
          <p className="text-gray-400">No tienes secuencias configuradas</p>
          <p className="mt-1 text-xs text-gray-500">Crea tu primera secuencia de follow-up o nurturing</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sequences.data.map((seq) => {
            const seqSteps = (seq.steps ?? []) as Step[];
            return (
              <div
                key={seq.id}
                className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 transition-colors hover:bg-gray-900/70"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-white">{seq.name}</h3>
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", typeColors[seq.type] ?? "bg-gray-700 text-gray-300")}>
                          {typeLabels[seq.type] ?? seq.type}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium",
                            seq.isActive ? "bg-green-500/20 text-green-300" : "bg-gray-700 text-gray-400"
                          )}
                        >
                          {seq.isActive ? "Activa" : "Inactiva"}
                        </span>
                      </div>
                      {seq.description && (
                        <p className="mt-0.5 text-xs text-gray-500">{seq.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right text-xs text-gray-400">
                      <p>{seqSteps.length} pasos</p>
                      <p>{seq.totalEnrolled} inscritos · {seq.totalCompleted} completados</p>
                    </div>
                    <button
                      onClick={() => toggleActive.mutate({ id: seq.id })}
                      className={cn(
                        "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                        seq.isActive
                          ? "bg-red-500/20 text-red-300 hover:bg-red-500/30"
                          : "bg-green-500/20 text-green-300 hover:bg-green-500/30"
                      )}
                    >
                      {seq.isActive ? "Desactivar" : "Activar"}
                    </button>
                    <button
                      onClick={() => setSelectedId(selectedId === seq.id ? null : seq.id)}
                      className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
                    >
                      {selectedId === seq.id ? "Cerrar" : "Ver"}
                    </button>
                  </div>
                </div>

                {/* Expanded detail */}
                {selectedId === seq.id && (
                  <SequenceDetail sequenceId={seq.id} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SequenceDetail({ sequenceId }: { sequenceId: string }) {
  const detail = trpc.sequences.getById.useQuery({ id: sequenceId });

  if (!detail.data) return <p className="mt-3 text-xs text-gray-500">Cargando...</p>;

  const { stats, enrollments } = detail.data;
  const seqSteps = (detail.data.steps ?? []) as Step[];

  return (
    <div className="mt-4 space-y-4 border-t border-gray-800 pt-4">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Activos", value: stats.activeCount },
            { label: "Completados", value: stats.completedCount },
            { label: "Cancelados", value: stats.cancelledCount },
            { label: "Conversion", value: `${stats.conversionRate}%` },
          ].map((s) => (
            <div key={s.label} className="rounded-lg bg-gray-800/50 p-3 text-center">
              <p className="text-lg font-bold text-white">{s.value}</p>
              <p className="text-[10px] text-gray-500">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Steps timeline */}
      <div>
        <h4 className="mb-2 text-xs font-semibold text-gray-400">Pasos</h4>
        <div className="space-y-2">
          {seqSteps.map((step, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg bg-gray-800/30 px-3 py-2">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                {i + 1}
              </div>
              <span className="text-xs text-gray-400">
                {step.delayDays === 0 ? "Inmediato" : `+${step.delayDays}d`}
              </span>
              <span className="text-xs text-gray-300">
                {step.actionType === "send_message" ? "Enviar mensaje" : "Notificacion"}
              </span>
              {step.actionType === "send_message" && (
                <span className="flex-1 truncate text-xs text-gray-500">
                  {(step.actionConfig.content as string)?.slice(0, 60)}...
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Enrollments */}
      {enrollments.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold text-gray-400">Contactos inscritos</h4>
          <div className="space-y-1">
            {enrollments.slice(0, 10).map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded-lg bg-gray-800/30 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white">{e.contactDisplayName ?? e.contactUsername}</span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px]",
                      e.status === "active" ? "bg-green-500/20 text-green-300" :
                      e.status === "completed" ? "bg-blue-500/20 text-blue-300" :
                      "bg-gray-700 text-gray-400"
                    )}
                  >
                    {e.status}
                  </span>
                </div>
                <span className="text-[10px] text-gray-500">
                  Paso {e.currentStep + 1}/{seqSteps.length}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
