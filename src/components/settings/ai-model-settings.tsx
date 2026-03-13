"use client";

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type Provider = "anthropic" | "openai" | "google" | "minimax" | "kimi";

const providerInfo: Record<Provider, { label: string; placeholder: string }> = {
  anthropic: {
    label: "Anthropic (Claude)",
    placeholder: "sk-ant-...",
  },
  openai: {
    label: "OpenAI (GPT)",
    placeholder: "sk-...",
  },
  google: {
    label: "Google (Gemini)",
    placeholder: "AIza...",
  },
  minimax: {
    label: "MiniMax",
    placeholder: "eyJ...",
  },
  kimi: {
    label: "Kimi (Moonshot)",
    placeholder: "sk-...",
  },
};

export function AIModelSettings() {
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Saved config from DB
  const [savedProvider, setSavedProvider] = useState<Provider | null>(null);
  const [savedModel, setSavedModel] = useState<string | null>(null);
  const [savedApiKeyMasked, setSavedApiKeyMasked] = useState<string | null>(null);

  const configQuery = trpc.aiConfig.get.useQuery();

  useEffect(() => {
    const data = configQuery.data;
    if (data) {
      setProvider(data.provider);
      setModel(data.model);
      setApiKey(data.apiKey);
      setSavedProvider(data.provider);
      setSavedModel(data.model);
      setSavedApiKeyMasked(data.apiKey);
    }
  }, [configQuery.data]);

  const modelsQuery = trpc.aiConfig.getModels.useQuery();

  const utils = trpc.useUtils();
  const upsertConfig = trpc.aiConfig.upsert.useMutation({
    onMutate: async () => {
      await utils.aiConfig.get.cancel();
    },
    onSuccess: (data) => {
      setSaved(true);
      setIsEditing(false);
      setTimeout(() => setSaved(false), 2000);
      if (data) {
        setSavedProvider(data.provider);
        setSavedModel(data.model);
        setSavedApiKeyMasked(data.apiKey);
        setApiKey(data.apiKey);
      }
      utils.aiConfig.get.invalidate();
    },
  });

  const testConnection = trpc.aiConfig.testConnection.useMutation({
    onSuccess: (result) => {
      setTestResult(result);
      setTimeout(() => setTestResult(null), 5000);
    },
    onError: (error) => {
      setTestResult({ success: false, message: error.message });
      setTimeout(() => setTestResult(null), 5000);
    },
  });

  const availableModels = modelsQuery.data?.[provider] ?? [];

  useEffect(() => {
    if (availableModels.length > 0 && !availableModels.find((m) => m.value === model)) {
      setModel(availableModels[0]!.value);
    }
  }, [provider, availableModels, model]);

  const hasConfig = savedProvider !== null;
  const hasChanges =
    provider !== savedProvider ||
    model !== savedModel ||
    (apiKey !== savedApiKeyMasked && apiKey !== "");

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    upsertConfig.mutate({ provider, model, apiKey });
  }

  function handleTest() {
    setTestResult(null);
    testConnection.mutate({ provider, model, apiKey });
  }

  function handleCancel() {
    if (savedProvider) setProvider(savedProvider);
    if (savedModel) setModel(savedModel);
    if (savedApiKeyMasked) setApiKey(savedApiKeyMasked);
    setIsEditing(false);
  }

  // Find the label for the saved model
  const allModels = modelsQuery.data;
  const savedModelLabel = allModels && savedProvider && savedModel
    ? allModels[savedProvider]?.find((m) => m.value === savedModel)?.label ?? savedModel
    : savedModel;

  return (
    <div>
      <h3 className="mb-1 text-base font-semibold text-white">
        Modelo de IA
      </h3>
      <p className="mb-6 text-sm text-gray-400">
        Configura qué proveedor y modelo de IA usará la aplicación para generar
        respuestas
      </p>

      {/* Current config summary */}
      {hasConfig && !isEditing && (
        <div className="mb-6 max-w-2xl rounded-lg border border-gray-700 bg-gray-800/50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-sm font-medium text-white">
              Configuración actual
            </h4>
            <div className="flex items-center gap-2">
              {saved && <span className="text-sm text-green-400">Guardado</span>}
              <button
                onClick={() => setIsEditing(true)}
                className="rounded-lg border border-gray-600 px-4 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 hover:text-white"
              >
                Modificar
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="mb-1 text-xs text-gray-400">Proveedor</p>
              <p className="text-sm font-medium text-white">
                {providerInfo[savedProvider!]?.label}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs text-gray-400">Modelo</p>
              <p className="text-sm font-medium text-white">
                {savedModelLabel}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs text-gray-400">API Key</p>
              <p className="font-mono text-sm text-gray-300">
                {savedApiKeyMasked}
              </p>
            </div>
          </div>

          {/* Quick test button */}
          <div className="mt-4 border-t border-gray-700 pt-4">
            <button
              onClick={handleTest}
              disabled={testConnection.isPending}
              className="rounded-lg border border-gray-600 px-4 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-50"
            >
              {testConnection.isPending ? "Probando..." : "Probar conexión"}
            </button>
            {testResult && (
              <span
                className={cn(
                  "ml-3 text-xs",
                  testResult.success ? "text-green-400" : "text-red-400"
                )}
              >
                {testResult.message}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Edit form (shown when no config or editing) */}
      {(!hasConfig || isEditing) && (
        <form onSubmit={handleSave} className="max-w-2xl space-y-5">
          {/* Provider selector */}
          <div>
            <label className="mb-2 block text-sm text-gray-300">
              Proveedor
            </label>
            <div className="grid grid-cols-3 gap-3">
              {(Object.keys(providerInfo) as Provider[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className={cn(
                    "relative rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
                    provider === p
                      ? "border-indigo-500 bg-indigo-600/20 text-white"
                      : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600 hover:text-white",
                  )}
                >
                  {providerInfo[p].label}
                  {/* Badge if this is the currently saved provider */}
                  {savedProvider === p && (
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-[8px] text-white">
                      <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Model selector */}
          <div>
            <label className="mb-1 block text-sm text-gray-300">Modelo</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              {availableModels.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* API Key */}
          <div>
            <label className="mb-1 block text-sm text-gray-300">API Key</label>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type="password"
              placeholder={
                hasConfig
                  ? "Deja vacío para mantener la actual"
                  : providerInfo[provider].placeholder
              }
              required={!hasConfig}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-500">
              {hasConfig
                ? "Solo introduce una nueva clave si quieres cambiarla"
                : "La API key se almacena de forma segura y nunca se muestra completa"}
            </p>
          </div>

          {/* Test result */}
          {testResult && (
            <div
              className={cn(
                "rounded-lg border px-4 py-3 text-sm",
                testResult.success
                  ? "border-green-800 bg-green-900/20 text-green-400"
                  : "border-red-800 bg-red-900/20 text-red-400"
              )}
            >
              {testResult.message}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={upsertConfig.isPending || (!hasChanges && hasConfig)}
              className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {upsertConfig.isPending ? "Guardando..." : "Guardar"}
            </button>

            <button
              type="button"
              onClick={handleTest}
              disabled={testConnection.isPending || !apiKey}
              className="rounded-lg border border-gray-600 px-6 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-50"
            >
              {testConnection.isPending ? "Probando..." : "Probar conexión"}
            </button>

            {isEditing && (
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2.5 text-sm text-gray-400 hover:text-white"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      {/* Info box */}
      <div className="mt-8 max-w-2xl rounded-lg border border-gray-800 bg-gray-900/50 p-4">
        <h4 className="mb-2 text-sm font-medium text-gray-300">
          Sobre los proveedores
        </h4>
        <ul className="space-y-1 text-xs text-gray-400">
          <li>
            <strong className="text-gray-300">Anthropic:</strong> Claude Sonnet
            4.6 recomendado. Mejor relación calidad/precio.
          </li>
          <li>
            <strong className="text-gray-300">OpenAI:</strong> GPT-4o para alta
            calidad. GPT-4o Mini para ahorrar costes.
          </li>
          <li>
            <strong className="text-gray-300">Google:</strong> Gemini 2.5 Flash
            es rápido y económico.
          </li>
          <li>
            <strong className="text-gray-300">MiniMax:</strong> MiniMax-M2.5.
            API compatible con OpenAI.
          </li>
          <li>
            <strong className="text-gray-300">Kimi:</strong> Kimi K2 de
            Moonshot. Buen rendimiento multilingüe.
          </li>
        </ul>
      </div>

      {/* Multi-model assignments */}
      {hasConfig && <MultiModelSection models={modelsQuery.data} />}
    </div>
  );
}

const TASK_TYPES = [
  { value: "suggestion", label: "Sugerencias", description: "Generacion de respuestas para el creador" },
  { value: "analysis", label: "Analisis", description: "Sentimiento y señales conductuales" },
  { value: "summary", label: "Resumenes", description: "Resumen automatico de conversaciones" },
  { value: "report", label: "Informes", description: "Informes detallados de contactos" },
  { value: "price_advice", label: "Precios", description: "Recomendaciones de precio" },
] as const;

type TaskType = typeof TASK_TYPES[number]["value"];

function MultiModelSection({ models }: { models: Record<string, { value: string; label: string }[]> | undefined }) {
  const [editingTask, setEditingTask] = useState<TaskType | null>(null);
  const [taskProvider, setTaskProvider] = useState<Provider>("anthropic");
  const [taskModel, setTaskModel] = useState("");

  const utils = trpc.useUtils();
  const { data: assignments } = trpc.aiConfig.getAssignments.useQuery();
  const upsertAssignment = trpc.aiConfig.upsertAssignment.useMutation({
    onSuccess: () => {
      utils.aiConfig.getAssignments.invalidate();
      setEditingTask(null);
    },
  });
  const deleteAssignment = trpc.aiConfig.deleteAssignment.useMutation({
    onSuccess: () => {
      utils.aiConfig.getAssignments.invalidate();
    },
  });

  function handleEditTask(taskType: TaskType) {
    const existing = assignments?.find((a) => a.taskType === taskType);
    if (existing) {
      setTaskProvider(existing.provider);
      setTaskModel(existing.model);
    } else {
      setTaskProvider("anthropic");
      setTaskModel("");
    }
    setEditingTask(taskType);
  }

  function handleSaveTask() {
    if (!editingTask || !taskModel) return;
    upsertAssignment.mutate({
      taskType: editingTask,
      provider: taskProvider,
      model: taskModel,
    });
  }

  const taskModels = models?.[taskProvider] ?? [];

  return (
    <div className="mt-8 max-w-2xl">
      <h3 className="mb-1 text-sm font-semibold text-white">Modo multi-modelo</h3>
      <p className="mb-4 text-xs text-gray-400">
        Asigna modelos diferentes para cada tipo de tarea. Si no asignas uno, se usa el modelo principal.
      </p>

      <div className="space-y-2">
        {TASK_TYPES.map((task) => {
          const assignment = assignments?.find((a) => a.taskType === task.value);
          const isEditing = editingTask === task.value;

          return (
            <div
              key={task.value}
              className="rounded-lg border border-gray-700 bg-gray-800/50 p-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-white">{task.label}</span>
                  <p className="text-xs text-gray-500">{task.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  {assignment && !isEditing && (
                    <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-300">
                      {assignment.provider}/{assignment.model}
                    </span>
                  )}
                  {!assignment && !isEditing && (
                    <span className="text-xs text-gray-600">Modelo principal</span>
                  )}
                  {!isEditing && (
                    <button
                      onClick={() => handleEditTask(task.value)}
                      className="text-xs text-indigo-400 hover:text-indigo-300"
                    >
                      {assignment ? "Cambiar" : "Asignar"}
                    </button>
                  )}
                  {assignment && !isEditing && (
                    <button
                      onClick={() => deleteAssignment.mutate({ taskType: task.value })}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Quitar
                    </button>
                  )}
                </div>
              </div>

              {isEditing && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-[120px]">
                    <label className="mb-1 block text-[10px] uppercase text-gray-500">Proveedor</label>
                    <select
                      value={taskProvider}
                      onChange={(e) => {
                        const p = e.target.value as Provider;
                        setTaskProvider(p);
                        const firstModel = models?.[p]?.[0]?.value ?? "";
                        setTaskModel(firstModel);
                      }}
                      className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                    >
                      {(["anthropic", "openai", "google", "minimax", "kimi"] as const).map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <label className="mb-1 block text-[10px] uppercase text-gray-500">Modelo</label>
                    <select
                      value={taskModel}
                      onChange={(e) => setTaskModel(e.target.value)}
                      className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="">Seleccionar...</option>
                      {taskModels.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={handleSaveTask}
                    disabled={!taskModel || upsertAssignment.isPending}
                    className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {upsertAssignment.isPending ? "..." : "Guardar"}
                  </button>
                  <button
                    onClick={() => setEditingTask(null)}
                    className="px-2 py-1.5 text-xs text-gray-400 hover:text-white"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
