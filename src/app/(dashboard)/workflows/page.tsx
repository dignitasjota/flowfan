"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const triggerTypeLabels: Record<string, string> = {
  no_response_timeout: "Sin respuesta",
  funnel_stage_change: "Cambio de funnel",
  sentiment_change: "Cambio de sentimiento",
  keyword_detected: "Keyword detectado",
  new_contact: "Nuevo contacto",
};

const triggerTypeColors: Record<string, string> = {
  no_response_timeout: "bg-blue-500/20 text-blue-300",
  funnel_stage_change: "bg-purple-500/20 text-purple-300",
  sentiment_change: "bg-amber-500/20 text-amber-300",
  keyword_detected: "bg-green-500/20 text-green-300",
  new_contact: "bg-teal-500/20 text-teal-300",
};

const actionTypeLabels: Record<string, string> = {
  send_message: "Enviar mensaje",
  send_template: "Enviar template",
  create_notification: "Crear notificación",
  change_tags: "Cambiar tags",
};

const actionTypeColors: Record<string, string> = {
  send_message: "bg-blue-500/20 text-blue-300",
  send_template: "bg-indigo-500/20 text-indigo-300",
  create_notification: "bg-amber-500/20 text-amber-300",
  change_tags: "bg-green-500/20 text-green-300",
};

const funnelStages = [
  { value: "", label: "Cualquiera" },
  { value: "cold", label: "Cold" },
  { value: "curious", label: "Curious" },
  { value: "interested", label: "Interested" },
  { value: "hot_lead", label: "Hot Lead" },
  { value: "buyer", label: "Buyer" },
  { value: "vip", label: "VIP" },
];

const conditionFields = [
  { value: "funnelStage", label: "Funnel Stage" },
  { value: "platformType", label: "Plataforma" },
  { value: "engagementLevel", label: "Nivel de engagement" },
  { value: "paymentProbability", label: "Probabilidad de pago" },
];

const conditionOperators = [
  { value: "eq", label: "=" },
  { value: "neq", label: "!=" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
  { value: "in", label: "in" },
  { value: "contains", label: "contains" },
];

type TriggerType = "no_response_timeout" | "funnel_stage_change" | "sentiment_change" | "keyword_detected" | "new_contact";
type ActionType = "send_message" | "send_template" | "create_notification" | "change_tags";

type Workflow = {
  id: string;
  name: string;
  description: string | null;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  conditions: Condition[];
  actionType: ActionType;
  actionConfig: Record<string, unknown>;
  cooldownMinutes: number;
  isActive: boolean;
  executionCount: number;
  lastExecutedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  creatorId: string;
};

export default function WorkflowsPage() {
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [showHistory, setShowHistory] = useState<{ id: string; name: string } | null>(null);

  const workflows = trpc.workflows.list.useQuery({}, { retry: false });
  const stats = trpc.workflows.getStats.useQuery(undefined, { retry: false });
  const deleteMutation = trpc.workflows.delete.useMutation({
    onSuccess: () => { workflows.refetch(); stats.refetch(); },
  });
  const toggleActiveMutation = trpc.workflows.toggleActive.useMutation({
    onSuccess: () => { workflows.refetch(); stats.refetch(); },
  });

  // Plan gate
  if (workflows.error?.data?.code === "FORBIDDEN") {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="text-center">
          <p className="text-lg font-medium text-white">Automatizaciones</p>
          <p className="mt-2 text-sm text-gray-400">
            Esta funcionalidad requiere el plan Starter o superior.
          </p>
          <a href="/billing" className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
            Ver planes
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white sm:text-2xl">Automatizaciones</h1>
          <p className="mt-1 text-sm text-gray-400">Reglas automáticas para gestionar tus fans</p>
        </div>
        <button
          onClick={() => { setEditingWorkflow(null); setShowBuilder(true); }}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          + Nueva regla
        </button>
      </div>

      {/* Stats */}
      {stats.data && (
        <div className="mt-4 flex flex-wrap gap-3">
          <span className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300">
            {stats.data.totalWorkflows} workflows
          </span>
          <span className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300">
            {stats.data.activeWorkflows} activas
          </span>
          <span className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300">
            {stats.data.totalExecutions} ejecuciones totales
          </span>
          <span className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300">
            {stats.data.successRate}% tasa de éxito
          </span>
          <span className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300">
            {stats.data.last7DaysExecutions} últimos 7 días
          </span>
        </div>
      )}

      {/* Workflow list */}
      <div className="mt-6 space-y-3">
        {workflows.data?.map((wf) => (
          <div
            key={wf.id}
            className="rounded-xl border border-gray-800 bg-gray-900 p-4 transition-colors hover:border-gray-700"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <h3 className="truncate text-sm font-semibold text-white">{wf.name}</h3>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", triggerTypeColors[wf.triggerType] ?? "bg-gray-700 text-gray-300")}>
                    {triggerTypeLabels[wf.triggerType] ?? wf.triggerType}
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", actionTypeColors[wf.actionType] ?? "bg-gray-700 text-gray-300")}>
                    {actionTypeLabels[wf.actionType] ?? wf.actionType}
                  </span>
                </div>
                {wf.description && (
                  <p className="mt-1 text-xs text-gray-500">{wf.description}</p>
                )}
                <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                  <span>{wf.executionCount} ejecuciones</span>
                  {wf.lastExecutedAt && (
                    <span>Última: {new Date(wf.lastExecutedAt).toLocaleDateString("es-ES")}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Toggle active */}
                <button
                  onClick={() => toggleActiveMutation.mutate({ id: wf.id, isActive: !wf.isActive })}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                    wf.isActive ? "bg-indigo-600" : "bg-gray-700"
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
                      wf.isActive ? "translate-x-5" : "translate-x-0"
                    )}
                  />
                </button>

                {/* History */}
                <button
                  onClick={() => setShowHistory({ id: wf.id, name: wf.name })}
                  className="rounded-lg border border-gray-700 px-2.5 py-1.5 text-xs text-gray-400 hover:text-white"
                  title="Ver historial"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                </button>

                {/* Edit */}
                <button
                  onClick={() => { setEditingWorkflow(wf as unknown as Workflow); setShowBuilder(true); }}
                  className="rounded-lg border border-gray-700 px-2.5 py-1.5 text-xs text-gray-400 hover:text-white"
                  title="Editar"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                  </svg>
                </button>

                {/* Delete */}
                <button
                  onClick={() => {
                    if (confirm(`¿Eliminar la automatización "${wf.name}"?`)) {
                      deleteMutation.mutate({ id: wf.id });
                    }
                  }}
                  className="rounded-lg border border-red-800 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-900/20"
                  title="Eliminar"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {workflows.data?.length === 0 && (
        <div className="mt-12 text-center">
          <p className="text-lg text-gray-400">Sin automatizaciones</p>
          <p className="mt-1 text-sm text-gray-600">Crea tu primera regla para automatizar la gestión de fans</p>
          <button
            onClick={() => { setEditingWorkflow(null); setShowBuilder(true); }}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            + Nueva regla
          </button>
        </div>
      )}

      {/* Builder modal */}
      {showBuilder && (
        <WorkflowBuilder
          workflow={editingWorkflow}
          onClose={() => { setShowBuilder(false); setEditingWorkflow(null); }}
          onSaved={() => {
            setShowBuilder(false);
            setEditingWorkflow(null);
            workflows.refetch();
            stats.refetch();
          }}
        />
      )}

      {/* Execution history modal */}
      {showHistory && (
        <ExecutionHistory
          workflowId={showHistory.id}
          workflowName={showHistory.name}
          onClose={() => setShowHistory(null)}
        />
      )}
    </div>
  );
}

// ==================== Workflow Builder ====================

type Condition = { field: string; operator: string; value: string };

function WorkflowBuilder({
  workflow,
  onClose,
  onSaved,
}: {
  workflow?: Workflow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(workflow?.name ?? "");
  const [description, setDescription] = useState(workflow?.description ?? "");
  const [triggerType, setTriggerType] = useState<TriggerType>(workflow?.triggerType ?? "no_response_timeout");
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>(workflow?.triggerConfig ?? {});
  const [conditions, setConditions] = useState<Condition[]>(workflow?.conditions ?? []);
  const [actionType, setActionType] = useState<ActionType>(workflow?.actionType ?? "send_message");
  const [actionConfig, setActionConfig] = useState<Record<string, unknown>>(workflow?.actionConfig ?? {});
  const [cooldownMinutes, setCooldownMinutes] = useState(workflow?.cooldownMinutes ?? 60);
  const [saving, setSaving] = useState(false);

  const templates = trpc.templates.list.useQuery({}, {
    enabled: actionType === "send_template",
  });

  const createMutation = trpc.workflows.create.useMutation({ onSuccess: onSaved });
  const updateMutation = trpc.workflows.update.useMutation({ onSuccess: onSaved });

  const handleSave = () => {
    if (!name.trim()) return;
    setSaving(true);

    const base = {
      name: name.trim(),
      description: description.trim() || undefined,
      triggerType,
      triggerConfig,
      conditions,
      actionType,
      actionConfig,
      cooldownMinutes,
    };

    if (workflow?.id) {
      updateMutation.mutate({ id: workflow.id, ...base });
    } else {
      createMutation.mutate(base);
    }
  };

  const addCondition = () => {
    setConditions([...conditions, { field: "funnelStage", operator: "eq", value: "" }]);
  };

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const updateCondition = (index: number, patch: Partial<Condition>) => {
    setConditions(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-white">
          {workflow ? "Editar automatización" : "Nueva automatización"}
        </h2>

        {/* Section 1 - Trigger */}
        <div className="mt-6">
          <h3 className="text-sm font-medium text-gray-300">Trigger</h3>
          <select
            value={triggerType}
            onChange={(e) => { setTriggerType(e.target.value as TriggerType); setTriggerConfig({}); }}
            className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          >
            {Object.entries(triggerTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          {/* Dynamic trigger config */}
          <div className="mt-3">
            {triggerType === "no_response_timeout" && (
              <div>
                <label className="text-xs text-gray-500">Minutos sin respuesta</label>
                <input
                  type="number"
                  value={(triggerConfig.minutes as number) ?? 60}
                  onChange={(e) => setTriggerConfig({ ...triggerConfig, minutes: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                  min={1}
                />
              </div>
            )}

            {triggerType === "funnel_stage_change" && (
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-500">De</label>
                  <select
                    value={(triggerConfig.from as string) ?? ""}
                    onChange={(e) => setTriggerConfig({ ...triggerConfig, from: e.target.value || null })}
                    className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                  >
                    {funnelStages.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-500">A</label>
                  <select
                    value={(triggerConfig.to as string) ?? ""}
                    onChange={(e) => setTriggerConfig({ ...triggerConfig, to: e.target.value || null })}
                    className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                  >
                    {funnelStages.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {triggerType === "sentiment_change" && (
              <div>
                <label className="text-xs text-gray-500">Dirección</label>
                <select
                  value={(triggerConfig.direction as string) ?? "negative"}
                  onChange={(e) => setTriggerConfig({ ...triggerConfig, direction: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                >
                  <option value="positive">Positivo</option>
                  <option value="negative">Negativo</option>
                </select>
              </div>
            )}

            {triggerType === "keyword_detected" && (
              <div>
                <label className="text-xs text-gray-500">Keywords (separados por coma)</label>
                <input
                  type="text"
                  value={(triggerConfig.keywords as string) ?? ""}
                  onChange={(e) => setTriggerConfig({ ...triggerConfig, keywords: e.target.value })}
                  placeholder="comprar, precio, descuento"
                  className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
                />
              </div>
            )}

            {triggerType === "new_contact" && (
              <div>
                <label className="text-xs text-gray-500">Plataforma (opcional)</label>
                <select
                  value={(triggerConfig.platform as string) ?? ""}
                  onChange={(e) => setTriggerConfig({ ...triggerConfig, platform: e.target.value || null })}
                  className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                >
                  <option value="">Todas las plataformas</option>
                  <option value="onlyfans">OnlyFans</option>
                  <option value="fansly">Fansly</option>
                  <option value="telegram">Telegram</option>
                  <option value="instagram">Instagram</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Section 2 - Conditions */}
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-300">Condiciones adicionales (opcional)</h3>
            <button
              onClick={addCondition}
              className="rounded-lg border border-gray-700 px-2.5 py-1 text-xs text-gray-400 hover:text-white"
            >
              + Añadir
            </button>
          </div>

          {conditions.length > 0 && (
            <div className="mt-3 space-y-2">
              {conditions.map((cond, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={cond.field}
                    onChange={(e) => updateCondition(i, { field: e.target.value })}
                    className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white"
                  >
                    {conditionFields.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                  <select
                    value={cond.operator}
                    onChange={(e) => updateCondition(i, { operator: e.target.value })}
                    className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white"
                  >
                    {conditionOperators.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={cond.value}
                    onChange={(e) => updateCondition(i, { value: e.target.value })}
                    placeholder="Valor"
                    className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white placeholder-gray-500"
                  />
                  <button
                    onClick={() => removeCondition(i)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section 3 - Action */}
        <div className="mt-6">
          <h3 className="text-sm font-medium text-gray-300">Acción</h3>
          <select
            value={actionType}
            onChange={(e) => { setActionType(e.target.value as ActionType); setActionConfig({}); }}
            className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          >
            {Object.entries(actionTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          {/* Dynamic action config */}
          <div className="mt-3">
            {actionType === "send_message" && (
              <div>
                <label className="text-xs text-gray-500">Mensaje</label>
                <textarea
                  value={(actionConfig.message as string) ?? ""}
                  onChange={(e) => setActionConfig({ ...actionConfig, message: e.target.value })}
                  rows={3}
                  placeholder="Escribe el mensaje..."
                  className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
                />
                <p className="mt-1 text-[10px] text-gray-600">
                  {"Variables: {{username}}, {{platformType}}"}
                </p>
              </div>
            )}

            {actionType === "send_template" && (
              <div>
                <label className="text-xs text-gray-500">Template</label>
                <select
                  value={(actionConfig.templateId as string) ?? ""}
                  onChange={(e) => setActionConfig({ ...actionConfig, templateId: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                >
                  <option value="">Seleccionar template...</option>
                  {templates.data?.map((t: { id: string; name: string }) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}

            {actionType === "create_notification" && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500">Título</label>
                  <input
                    type="text"
                    value={(actionConfig.title as string) ?? ""}
                    onChange={(e) => setActionConfig({ ...actionConfig, title: e.target.value })}
                    placeholder="Título de la notificación"
                    className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Mensaje</label>
                  <input
                    type="text"
                    value={(actionConfig.message as string) ?? ""}
                    onChange={(e) => setActionConfig({ ...actionConfig, message: e.target.value })}
                    placeholder="Contenido de la notificación"
                    className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
                  />
                </div>
              </div>
            )}

            {actionType === "change_tags" && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500">Tags a añadir (separados por coma)</label>
                  <input
                    type="text"
                    value={(actionConfig.addTags as string) ?? ""}
                    onChange={(e) => setActionConfig({ ...actionConfig, addTags: e.target.value })}
                    placeholder="vip, activo"
                    className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Tags a quitar (separados por coma)</label>
                  <input
                    type="text"
                    value={(actionConfig.removeTags as string) ?? ""}
                    onChange={(e) => setActionConfig({ ...actionConfig, removeTags: e.target.value })}
                    placeholder="nuevo, pendiente"
                    className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 4 - Configuration */}
        <div className="mt-6">
          <h3 className="text-sm font-medium text-gray-300">Configuración</h3>
          <div className="mt-3 space-y-3">
            <div>
              <label className="text-xs text-gray-500">Nombre *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre de la automatización"
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">Descripción (opcional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Describe qué hace esta automatización..."
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">Cooldown (minutos entre ejecuciones por contacto)</label>
              <input
                type="number"
                value={cooldownMinutes}
                onChange={(e) => setCooldownMinutes(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                min={0}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-white"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving || createMutation.isPending || updateMutation.isPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {createMutation.isPending || updateMutation.isPending ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== Execution History ====================

function ExecutionHistory({
  workflowId,
  workflowName,
  onClose,
}: {
  workflowId: string;
  workflowName: string;
  onClose: () => void;
}) {
  const executions = trpc.workflows.getExecutions.useQuery({ workflowId, limit: 20 });

  const statusBadge: Record<string, string> = {
    success: "bg-green-500/20 text-green-300",
    failed: "bg-red-500/20 text-red-300",
    skipped: "bg-gray-500/20 text-gray-400",
  };

  const statusLabels: Record<string, string> = {
    success: "Éxito",
    failed: "Error",
    skipped: "Omitido",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-xl max-h-[80vh] overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-white">Historial: {workflowName}</h2>

        {executions.data && executions.data.items.length > 0 ? (
          <div className="mt-4">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
                  <th className="pb-2 font-medium">Contacto</th>
                  <th className="pb-2 font-medium">Estado</th>
                  <th className="pb-2 text-right font-medium">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {executions.data.items.map((exec) => (
                  <tr key={exec.id} className="border-b border-gray-800/50">
                    <td className="py-2 text-sm text-gray-300">{exec.contact?.displayName ?? exec.contact?.username ?? "—"}</td>
                    <td className="py-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", statusBadge[exec.status] ?? "bg-gray-700 text-gray-300")}>
                        {statusLabels[exec.status] ?? exec.status}
                      </span>
                    </td>
                    <td className="py-2 text-right text-xs text-gray-500">
                      {new Date(exec.executedAt).toLocaleString("es-ES")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : executions.data?.items.length === 0 ? (
          <div className="mt-8 text-center">
            <p className="text-sm text-gray-500">Sin ejecuciones registradas</p>
          </div>
        ) : (
          <div className="mt-8 text-center">
            <p className="text-sm text-gray-500">Cargando...</p>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-white"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
