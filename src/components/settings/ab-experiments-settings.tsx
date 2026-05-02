"use client";

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type ModeType = "BASE" | "POTENCIAL_PREMIUM" | "CONVERSION" | "VIP" | "LOW_VALUE";

const MODE_LABELS: Record<ModeType, string> = {
  BASE: "Base / Observacion",
  POTENCIAL_PREMIUM: "Potencial Premium",
  CONVERSION: "Conversion / Ritual",
  VIP: "Alto Valor / VIP",
  LOW_VALUE: "Bajo Valor / Descarte",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-500/20 text-gray-300",
  running: "bg-green-500/20 text-green-300",
  completed: "bg-blue-500/20 text-blue-300",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  running: "En ejecucion",
  completed: "Completado",
};

type VariantConfig = {
  tone: string;
  style: string;
  messageLength: string;
  objectives: string;
  restrictions: string;
  additionalInstructions: string;
};

const EMPTY_CONFIG: VariantConfig = {
  tone: "",
  style: "",
  messageLength: "medium",
  objectives: "",
  restrictions: "",
  additionalInstructions: "",
};

type ExperimentResults = {
  variantA: { total: number; conversions: number; replies: number };
  variantB: { total: number; conversions: number; replies: number };
  confidence: number;
  suggestedWinner: string | null;
};

export function ABExperimentsSettings() {
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [modeType, setModeType] = useState<ModeType>("BASE");
  const [trafficSplit, setTrafficSplit] = useState(50);
  const [variantA, setVariantA] = useState<VariantConfig>({ ...EMPTY_CONFIG });
  const [variantB, setVariantB] = useState<VariantConfig>({ ...EMPTY_CONFIG });

  const listQuery = trpc.abExperiments.list.useQuery();

  const resultsQuery = trpc.abExperiments.getResults.useQuery(
    { id: selectedId! },
    { enabled: !!selectedId }
  );

  const createMutation = trpc.abExperiments.create.useMutation({
    onSuccess: () => {
      listQuery.refetch();
      resetForm();
    },
  });

  const startMutation = trpc.abExperiments.start.useMutation({
    onSuccess: () => listQuery.refetch(),
  });

  const stopMutation = trpc.abExperiments.stop.useMutation({
    onSuccess: () => {
      listQuery.refetch();
      if (selectedId) resultsQuery.refetch();
    },
  });

  const applyMutation = trpc.abExperiments.applyWinner.useMutation({
    onSuccess: () => listQuery.refetch(),
  });

  function resetForm() {
    setShowCreate(false);
    setName("");
    setModeType("BASE");
    setTrafficSplit(50);
    setVariantA({ ...EMPTY_CONFIG });
    setVariantB({ ...EMPTY_CONFIG });
  }

  function configToRecord(cfg: VariantConfig): Record<string, unknown> {
    return {
      tone: cfg.tone || undefined,
      style: cfg.style || undefined,
      messageLength: cfg.messageLength || undefined,
      objectives: cfg.objectives ? cfg.objectives.split(",").map((s) => s.trim()).filter(Boolean) : [],
      restrictions: cfg.restrictions ? cfg.restrictions.split(",").map((s) => s.trim()).filter(Boolean) : [],
      additionalInstructions: cfg.additionalInstructions || undefined,
    };
  }

  function handleCreate() {
    createMutation.mutate({
      name,
      modeType,
      variantAConfig: configToRecord(variantA),
      variantBConfig: configToRecord(variantB),
      trafficSplit,
    });
  }

  const results = resultsQuery.data as ExperimentResults | undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-white">Experimentos A/B</h4>
          <p className="mt-0.5 text-xs text-gray-500">
            Prueba variantes de configuracion de modos y mide cual funciona mejor
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {showCreate ? "Cancelar" : "Nuevo experimento"}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-5 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-gray-400">Nombre</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ej: Test tono VIP"
                className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Tipo de modo</label>
              <select
                value={modeType}
                onChange={(e) => setModeType(e.target.value as ModeType)}
                className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              >
                {Object.entries(MODE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">
                Trafico a variante B: {trafficSplit}%
              </label>
              <input
                type="range"
                min={10}
                max={90}
                value={trafficSplit}
                onChange={(e) => setTrafficSplit(Number(e.target.value))}
                className="mt-2 w-full"
              />
            </div>
          </div>

          {/* Variant configs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(["A", "B"] as const).map((variant) => {
              const cfg = variant === "A" ? variantA : variantB;
              const setCfg = variant === "A" ? setVariantA : setVariantB;
              return (
                <div key={variant} className="rounded-lg border border-gray-600 bg-gray-900 p-4 space-y-3">
                  <h5 className="text-sm font-medium text-white">
                    Variante {variant}
                    <span className="ml-2 text-xs text-gray-500">
                      ({variant === "A" ? 100 - trafficSplit : trafficSplit}% trafico)
                    </span>
                  </h5>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Tono</label>
                    <input
                      value={cfg.tone}
                      onChange={(e) => setCfg({ ...cfg, tone: e.target.value })}
                      placeholder="ej: seductor, amigable, directo"
                      className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Estilo</label>
                    <input
                      value={cfg.style}
                      onChange={(e) => setCfg({ ...cfg, style: e.target.value })}
                      placeholder="ej: casual, profesional"
                      className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Longitud mensaje</label>
                    <select
                      value={cfg.messageLength}
                      onChange={(e) => setCfg({ ...cfg, messageLength: e.target.value })}
                      className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="short">Corto</option>
                      <option value="medium">Medio</option>
                      <option value="long">Largo</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">
                      Objetivos (separados por coma)
                    </label>
                    <input
                      value={cfg.objectives}
                      onChange={(e) => setCfg({ ...cfg, objectives: e.target.value })}
                      placeholder="ej: vender PPV, fidelizar"
                      className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Instrucciones adicionales</label>
                    <textarea
                      value={cfg.additionalInstructions}
                      onChange={(e) => setCfg({ ...cfg, additionalInstructions: e.target.value })}
                      rows={2}
                      placeholder="Instrucciones extra para esta variante..."
                      className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-indigo-500 focus:outline-none resize-none"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={!name.trim() || createMutation.isPending}
              className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {createMutation.isPending ? "Creando..." : "Crear experimento"}
            </button>
            {createMutation.isError && (
              <span className="self-center text-sm text-red-400">{createMutation.error.message}</span>
            )}
          </div>
        </div>
      )}

      {/* Experiment list */}
      {listQuery.isLoading && <p className="text-sm text-gray-500">Cargando...</p>}

      {listQuery.data?.length === 0 && !showCreate && (
        <p className="text-sm text-gray-500">No hay experimentos creados</p>
      )}

      <div className="space-y-3">
        {listQuery.data?.map((exp) => (
          <div
            key={exp.id}
            className={cn(
              "rounded-lg border bg-gray-800 p-4",
              selectedId === exp.id ? "border-indigo-500" : "border-gray-700"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h5 className="text-sm font-medium text-white">{exp.name}</h5>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_COLORS[exp.status] ?? STATUS_COLORS.draft)}>
                  {STATUS_LABELS[exp.status] ?? exp.status}
                </span>
                <span className="text-xs text-gray-500">
                  {MODE_LABELS[exp.modeType as ModeType] ?? exp.modeType}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {exp.status === "draft" && (
                  <button
                    onClick={() => startMutation.mutate({ id: exp.id })}
                    disabled={startMutation.isPending}
                    className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    Iniciar
                  </button>
                )}
                {exp.status === "running" && (
                  <>
                    <button
                      onClick={() => setSelectedId(selectedId === exp.id ? null : exp.id)}
                      className="rounded border border-gray-600 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700"
                    >
                      {selectedId === exp.id ? "Ocultar" : "Ver resultados"}
                    </button>
                    <button
                      onClick={() => stopMutation.mutate({ id: exp.id })}
                      disabled={stopMutation.isPending}
                      className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      Detener
                    </button>
                  </>
                )}
                {exp.status === "completed" && (
                  <>
                    <button
                      onClick={() => setSelectedId(selectedId === exp.id ? null : exp.id)}
                      className="rounded border border-gray-600 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700"
                    >
                      {selectedId === exp.id ? "Ocultar" : "Ver resultados"}
                    </button>
                    {exp.winner && (
                      <button
                        onClick={() => applyMutation.mutate({ id: exp.id })}
                        disabled={applyMutation.isPending}
                        className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {applyMutation.isPending ? "..." : `Aplicar ganador (${exp.winner})`}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Info row */}
            <div className="mt-2 flex gap-4 text-xs text-gray-500">
              <span>Split: {100 - exp.trafficSplit}% A / {exp.trafficSplit}% B</span>
              {exp.startedAt && <span>Inicio: {new Date(exp.startedAt).toLocaleDateString()}</span>}
              {exp.endedAt && <span>Fin: {new Date(exp.endedAt).toLocaleDateString()}</span>}
              {exp.winner && (
                <span className="text-green-400">Ganador: Variante {exp.winner}</span>
              )}
            </div>

            {/* Results panel */}
            {selectedId === exp.id && (
              <div className="mt-4 border-t border-gray-700 pt-4">
                {resultsQuery.isLoading && (
                  <p className="text-sm text-gray-500">Cargando resultados...</p>
                )}
                {results && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      {(["A", "B"] as const).map((v) => {
                        const data = v === "A" ? results.variantA : results.variantB;
                        return (
                          <div key={v} className="rounded-lg border border-gray-600 bg-gray-900 p-3">
                            <h6 className="mb-2 text-xs font-medium text-gray-400">Variante {v}</h6>
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <p className="text-lg font-bold text-white">{data.total}</p>
                                <p className="text-[10px] text-gray-500">Contactos</p>
                              </div>
                              <div>
                                <p className="text-lg font-bold text-white">{data.replies}</p>
                                <p className="text-[10px] text-gray-500">Respuestas</p>
                              </div>
                              <div>
                                <p className="text-lg font-bold text-white">{data.conversions}</p>
                                <p className="text-[10px] text-gray-500">Conversiones</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-gray-600 bg-gray-900 p-3">
                      <div>
                        <span className="text-xs text-gray-400">Confianza estadistica: </span>
                        <span className={cn(
                          "text-sm font-medium",
                          results.confidence >= 0.95 ? "text-green-400" :
                          results.confidence >= 0.80 ? "text-amber-400" : "text-gray-400"
                        )}>
                          {(results.confidence * 100).toFixed(1)}%
                        </span>
                      </div>
                      {results.suggestedWinner && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">Ganador sugerido:</span>
                          <span className="text-sm font-medium text-green-400">
                            Variante {results.suggestedWinner}
                          </span>
                          {exp.status === "running" && (
                            <button
                              onClick={() => stopMutation.mutate({ id: exp.id, winner: results.suggestedWinner as "A" | "B" })}
                              disabled={stopMutation.isPending}
                              className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                            >
                              Declarar ganador
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
