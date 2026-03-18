"use client";

import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SegmentFilter = {
  field: string;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains";
  value: unknown;
};

type SegmentType = "dynamic" | "static" | "mixed";

type Segment = {
  id: string;
  name: string;
  description: string | null;
  type: SegmentType;
  filters: SegmentFilter[];
  color: string | null;
  icon: string | null;
  isPredefined: boolean;
  predefinedKey: string | null;
  contactCount: number;
  countUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  creatorId: string;
};

type EvaluatedContact = {
  id: string;
  username: string;
  displayName: string | null;
  platformType: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const fieldLabels: Record<string, string> = {
  platformType: "Plataforma",
  funnelStage: "Etapa funnel",
  engagementLevel: "Nivel engagement",
  paymentProbability: "Probabilidad pago",
  totalRevenue: "Revenue total (cents)",
  lastInteractionAt: "Ultima interaccion",
  createdAt: "Fecha creacion",
  tags: "Tags",
  estimatedBudget: "Presupuesto",
};

const operatorLabels: Record<string, string> = {
  eq: "=",
  neq: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  in: "in",
  contains: "contiene",
};

const typeLabels: Record<string, string> = {
  dynamic: "Dinamico",
  static: "Estatico",
  mixed: "Mixto",
};

const typeBadgeColors: Record<string, string> = {
  dynamic: "bg-blue-500/20 text-blue-300",
  static: "bg-green-500/20 text-green-300",
  mixed: "bg-purple-500/20 text-purple-300",
};

const platformLabels: Record<string, string> = {
  instagram: "Instagram",
  tinder: "Tinder",
  reddit: "Reddit",
  onlyfans: "OnlyFans",
  twitter: "Twitter",
  telegram: "Telegram",
  snapchat: "Snapchat",
  other: "Otro",
};

const funnelStageLabels: Record<string, string> = {
  cold: "Cold",
  curious: "Curious",
  interested: "Interested",
  hot_lead: "Hot Lead",
  buyer: "Buyer",
  vip: "VIP",
};

const relativeDateLabels: Record<string, string> = {
  "7_days_ago": "7 dias",
  "30_days_ago": "30 dias",
  "90_days_ago": "90 dias",
};

const budgetLabels: Record<string, string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  premium: "Premium",
};

// ---------------------------------------------------------------------------
// Filter display helper
// ---------------------------------------------------------------------------

function filterToReadable(filter: SegmentFilter): string {
  const fieldLabel = fieldLabels[filter.field] ?? filter.field;
  const op = operatorLabels[filter.operator] ?? filter.operator;

  let valueStr: string;

  if (filter.field === "funnelStage") {
    if (Array.isArray(filter.value)) {
      valueStr = (filter.value as string[]).map((v) => funnelStageLabels[v] ?? v).join(", ");
    } else {
      valueStr = funnelStageLabels[filter.value as string] ?? String(filter.value);
    }
  } else if (filter.field === "platformType") {
    if (Array.isArray(filter.value)) {
      valueStr = (filter.value as string[]).map((v) => platformLabels[v] ?? v).join(", ");
    } else {
      valueStr = platformLabels[filter.value as string] ?? String(filter.value);
    }
  } else if (filter.field === "totalRevenue") {
    const cents = Number(filter.value);
    valueStr = `${(cents / 100).toFixed(0)}EUR`;
  } else if (filter.field === "lastInteractionAt" || filter.field === "createdAt") {
    valueStr = relativeDateLabels[filter.value as string] ?? String(filter.value);
  } else if (filter.field === "estimatedBudget") {
    valueStr = budgetLabels[filter.value as string] ?? String(filter.value);
  } else {
    valueStr = String(filter.value);
  }

  return `${fieldLabel} ${op} ${valueStr}`;
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function SegmentsPage() {
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingSegment, setEditingSegment] = useState<Segment | null>(null);

  const segmentsList = trpc.segments.list.useQuery(undefined, { retry: false });
  const ensurePredefined = trpc.segments.ensurePredefined.useMutation({
    onSuccess: () => {
      segmentsList.refetch();
    },
  });
  const deleteMutation = trpc.segments.delete.useMutation({
    onSuccess: () => {
      segmentsList.refetch();
      setSelectedSegmentId(null);
    },
  });

  const evaluateQuery = trpc.segments.evaluate.useQuery(
    { id: selectedSegmentId! },
    { enabled: !!selectedSegmentId, retry: false }
  );

  // Ensure predefined segments exist on mount
  useEffect(() => {
    ensurePredefined.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Plan gate
  if (segmentsList.error?.data?.code === "FORBIDDEN") {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="text-center">
          <p className="text-lg font-medium text-white">Segmentos</p>
          <p className="mt-2 text-sm text-gray-400">
            Esta funcionalidad requiere el plan Starter o superior.
          </p>
          <a
            href="/billing"
            className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Ver planes
          </a>
        </div>
      </div>
    );
  }

  const allSegments = (segmentsList.data ?? []) as Segment[];
  const predefined = allSegments.filter((s) => s.isPredefined);
  const custom = allSegments.filter((s) => !s.isPredefined);
  const selectedSegment = allSegments.find((s) => s.id === selectedSegmentId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-1 bg-gray-950">
      {/* Left panel - Segment list */}
      <div className="flex w-80 flex-col border-r border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 p-4">
          <h1 className="text-lg font-bold text-white">Segmentos</h1>
          <p className="mt-0.5 text-xs text-gray-500">Agrupa contactos por criterios</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {/* Predefined */}
          {predefined.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                Predefinidos
              </p>
              <div className="space-y-1">
                {predefined.map((seg) => (
                  <SegmentRow
                    key={seg.id}
                    segment={seg}
                    isSelected={seg.id === selectedSegmentId}
                    onClick={() => setSelectedSegmentId(seg.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Custom */}
          <div>
            <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
              Mis segmentos
            </p>
            {custom.length > 0 ? (
              <div className="space-y-1">
                {custom.map((seg) => (
                  <SegmentRow
                    key={seg.id}
                    segment={seg}
                    isSelected={seg.id === selectedSegmentId}
                    onClick={() => setSelectedSegmentId(seg.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="px-1 text-xs text-gray-600">Sin segmentos personalizados</p>
            )}
          </div>
        </div>

        <div className="border-t border-gray-800 p-3">
          <button
            onClick={() => {
              setEditingSegment(null);
              setShowBuilder(true);
            }}
            className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            + Nuevo segmento
          </button>
        </div>
      </div>

      {/* Right panel - Detail or empty state */}
      <div className="flex flex-1 flex-col overflow-hidden bg-gray-950">
        {selectedSegment ? (
          <SegmentDetail
            segment={selectedSegment}
            contacts={evaluateQuery.data?.contacts ?? []}
            totalContacts={evaluateQuery.data?.total ?? 0}
            isLoading={evaluateQuery.isLoading}
            onEdit={() => {
              setEditingSegment(selectedSegment);
              setShowBuilder(true);
            }}
            onDelete={() => {
              if (confirm(`Eliminar el segmento "${selectedSegment.name}"?`)) {
                deleteMutation.mutate({ id: selectedSegment.id });
              }
            }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-gray-500">Selecciona un segmento para ver sus contactos</p>
            </div>
          </div>
        )}
      </div>

      {/* Builder modal */}
      {showBuilder && (
        <SegmentBuilder
          segment={editingSegment}
          onClose={() => {
            setShowBuilder(false);
            setEditingSegment(null);
          }}
          onSaved={() => {
            setShowBuilder(false);
            setEditingSegment(null);
            segmentsList.refetch();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segment Row
// ---------------------------------------------------------------------------

function SegmentRow({
  segment,
  isSelected,
  onClick,
}: {
  segment: Segment;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors",
        isSelected
          ? "border border-indigo-500 bg-indigo-500/10"
          : "border border-transparent hover:bg-gray-800"
      )}
    >
      {segment.icon && <span className="text-base">{segment.icon}</span>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{segment.name}</p>
      </div>
      <span
        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
        style={{
          backgroundColor: segment.color ? `${segment.color}20` : "rgba(99,102,241,0.2)",
          color: segment.color ?? "#818cf8",
        }}
      >
        {segment.contactCount}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Segment Detail
// ---------------------------------------------------------------------------

function SegmentDetail({
  segment,
  contacts,
  totalContacts,
  isLoading,
  onEdit,
  onDelete,
}: {
  segment: Segment;
  contacts: EvaluatedContact[];
  totalContacts: number;
  isLoading: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const filters = (segment.filters ?? []) as SegmentFilter[];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900 p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {segment.icon && <span className="text-2xl">{segment.icon}</span>}
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-white">{segment.name}</h2>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    typeBadgeColors[segment.type] ?? "bg-gray-700 text-gray-300"
                  )}
                >
                  {typeLabels[segment.type] ?? segment.type}
                </span>
              </div>
              {segment.description && (
                <p className="mt-0.5 text-xs text-gray-500">{segment.description}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onEdit}
              className="rounded-lg border border-gray-700 px-2.5 py-1.5 text-xs text-gray-400 hover:text-white"
              title="Editar"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
              </svg>
            </button>
            {!segment.isPredefined && (
              <button
                onClick={onDelete}
                className="rounded-lg border border-red-800 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-900/20"
                title="Eliminar"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        {filters.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {filters.map((f, i) => (
              <span
                key={i}
                className="rounded-full bg-gray-800 px-2.5 py-1 text-[11px] text-gray-300"
              >
                {filterToReadable(f)}
              </span>
            ))}
          </div>
        )}

        {/* Count */}
        <div className="mt-3">
          <span className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-400">
            {totalContacts} contactos
          </span>
        </div>
      </div>

      {/* Contact list */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="text-center">
            <p className="text-sm text-gray-500">Cargando contactos...</p>
          </div>
        ) : contacts.length > 0 ? (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
                <th className="pb-2 font-medium">Username</th>
                <th className="pb-2 font-medium">Nombre</th>
                <th className="pb-2 font-medium">Plataforma</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id} className="border-b border-gray-800/50">
                  <td className="py-2.5 text-sm text-white">{contact.username}</td>
                  <td className="py-2.5 text-sm text-gray-300">
                    {contact.displayName ?? "---"}
                  </td>
                  <td className="py-2.5">
                    <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-400">
                      {platformLabels[contact.platformType] ?? contact.platformType}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-center">
            <p className="text-sm text-gray-500">Sin contactos en este segmento</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segment Builder (modal)
// ---------------------------------------------------------------------------

const builderFieldOptions = [
  { value: "platformType", label: "Plataforma" },
  { value: "funnelStage", label: "Etapa funnel" },
  { value: "engagementLevel", label: "Nivel engagement" },
  { value: "paymentProbability", label: "Probabilidad pago" },
  { value: "totalRevenue", label: "Revenue total (cents)" },
  { value: "lastInteractionAt", label: "Ultima interaccion" },
  { value: "createdAt", label: "Fecha creacion" },
  { value: "tags", label: "Tags" },
  { value: "estimatedBudget", label: "Presupuesto" },
];

const builderOperatorOptions = [
  { value: "eq", label: "=" },
  { value: "neq", label: "!=" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
  { value: "in", label: "in" },
  { value: "contains", label: "contiene" },
];

const platformOptions = [
  "instagram",
  "tinder",
  "reddit",
  "onlyfans",
  "twitter",
  "telegram",
  "snapchat",
  "other",
];

const funnelStageOptions = [
  "cold",
  "curious",
  "interested",
  "hot_lead",
  "buyer",
  "vip",
];

const relativeDateOptions = [
  { value: "7_days_ago", label: "7 dias atras" },
  { value: "30_days_ago", label: "30 dias atras" },
  { value: "90_days_ago", label: "90 dias atras" },
];

const budgetOptions = ["low", "medium", "high", "premium"];

function SegmentBuilder({
  segment,
  onClose,
  onSaved,
}: {
  segment?: Segment | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(segment?.name ?? "");
  const [description, setDescription] = useState(segment?.description ?? "");
  const [type, setType] = useState<SegmentType>(segment?.type ?? "dynamic");
  const [color, setColor] = useState(segment?.color ?? "#6366f1");
  const [icon, setIcon] = useState(segment?.icon ?? "");
  const [filters, setFilters] = useState<SegmentFilter[]>(
    (segment?.filters as SegmentFilter[]) ?? []
  );
  const [debouncedFilters, setDebouncedFilters] = useState<SegmentFilter[]>(filters);

  const createMutation = trpc.segments.create.useMutation({ onSuccess: onSaved });
  const updateMutation = trpc.segments.update.useMutation({ onSuccess: onSaved });

  // Debounce filters for live count preview
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters);
    }, 500);
    return () => clearTimeout(timer);
  }, [filters]);

  const countQuery = trpc.segments.count.useQuery(
    { filters: debouncedFilters },
    {
      enabled: debouncedFilters.length > 0 && (type === "dynamic" || type === "mixed"),
      retry: false,
    }
  );

  const handleSave = () => {
    if (!name.trim()) return;

    const base = {
      name: name.trim(),
      description: description.trim() || undefined,
      filters,
      color: color || undefined,
      icon: icon || undefined,
    };

    if (segment?.id) {
      updateMutation.mutate({ id: segment.id, ...base });
    } else {
      createMutation.mutate({ ...base, type });
    }
  };

  const addFilter = () => {
    setFilters([...filters, { field: "funnelStage", operator: "eq", value: "" }]);
  };

  const removeFilter = (index: number) => {
    setFilters(filters.filter((_, i) => i !== index));
  };

  const updateFilter = (index: number, patch: Partial<SegmentFilter>) => {
    setFilters(
      filters.map((f, i) => (i === index ? { ...f, ...patch } : f))
    );
  };

  const showFilters = type === "dynamic" || type === "mixed";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-white">
          {segment ? "Editar segmento" : "Nuevo segmento"}
        </h2>

        {/* Section 1 - Basic */}
        <div className="mt-6">
          <h3 className="text-sm font-medium text-gray-300">Basico</h3>
          <div className="mt-3 space-y-3">
            <div>
              <label className="text-xs text-gray-500">Nombre *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre del segmento"
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">Descripcion (opcional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Describe este segmento..."
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
              />
            </div>
            {!segment && (
              <div>
                <label className="text-xs text-gray-500">Tipo</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as SegmentType)}
                  className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                >
                  <option value="dynamic">Dinamico (filtros automaticos)</option>
                  <option value="static">Estatico (miembros manuales)</option>
                  <option value="mixed">Mixto (filtros + manuales)</option>
                </select>
              </div>
            )}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-gray-500">Color</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="h-8 w-8 cursor-pointer rounded border border-gray-700 bg-gray-800"
                  />
                  <input
                    type="text"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                    maxLength={7}
                  />
                </div>
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500">Icono (emoji)</label>
                <input
                  type="text"
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  placeholder="ej: 🔥"
                  className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
                  maxLength={4}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section 2 - Filters */}
        {showFilters && (
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-300">Filtros</h3>
              <button
                onClick={addFilter}
                className="rounded-lg border border-gray-700 px-2.5 py-1 text-xs text-gray-400 hover:text-white"
              >
                + Anadir
              </button>
            </div>

            {filters.length > 0 && (
              <div className="mt-3 space-y-2">
                {filters.map((filter, i) => (
                  <FilterRow
                    key={i}
                    filter={filter}
                    onChange={(patch) => updateFilter(i, patch)}
                    onRemove={() => removeFilter(i)}
                  />
                ))}
              </div>
            )}

            {/* Live count preview */}
            {debouncedFilters.length > 0 && (
              <div className="mt-3">
                <span className="rounded bg-indigo-500/10 px-2.5 py-1 text-xs text-indigo-300">
                  {countQuery.isLoading
                    ? "Calculando..."
                    : `${countQuery.data?.count ?? 0} contactos coinciden`}
                </span>
              </div>
            )}
          </div>
        )}

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
            disabled={
              !name.trim() ||
              createMutation.isPending ||
              updateMutation.isPending
            }
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {createMutation.isPending || updateMutation.isPending
              ? "Guardando..."
              : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter Row
// ---------------------------------------------------------------------------

function FilterRow({
  filter,
  onChange,
  onRemove,
}: {
  filter: SegmentFilter;
  onChange: (patch: Partial<SegmentFilter>) => void;
  onRemove: () => void;
}) {
  const renderValueInput = () => {
    switch (filter.field) {
      case "platformType":
        return (
          <select
            value={String(filter.value)}
            onChange={(e) => onChange({ value: e.target.value })}
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white"
          >
            <option value="">Seleccionar...</option>
            {platformOptions.map((p) => (
              <option key={p} value={p}>
                {platformLabels[p] ?? p}
              </option>
            ))}
          </select>
        );

      case "funnelStage":
        return (
          <select
            value={String(filter.value)}
            onChange={(e) => onChange({ value: e.target.value })}
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white"
          >
            <option value="">Seleccionar...</option>
            {funnelStageOptions.map((s) => (
              <option key={s} value={s}>
                {funnelStageLabels[s] ?? s}
              </option>
            ))}
          </select>
        );

      case "engagementLevel":
      case "paymentProbability":
        return (
          <input
            type="number"
            value={Number(filter.value) || ""}
            onChange={(e) => onChange({ value: Number(e.target.value) })}
            placeholder="0-100"
            min={0}
            max={100}
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white placeholder-gray-500"
          />
        );

      case "totalRevenue":
        return (
          <input
            type="number"
            value={Number(filter.value) || ""}
            onChange={(e) => onChange({ value: Number(e.target.value) })}
            placeholder="Centimos (ej: 10000 = 100EUR)"
            min={0}
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white placeholder-gray-500"
          />
        );

      case "lastInteractionAt":
      case "createdAt":
        return (
          <select
            value={String(filter.value)}
            onChange={(e) => onChange({ value: e.target.value })}
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white"
          >
            <option value="">Seleccionar...</option>
            {relativeDateOptions.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        );

      case "tags":
        return (
          <input
            type="text"
            value={String(filter.value)}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder="Tag..."
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white placeholder-gray-500"
          />
        );

      case "estimatedBudget":
        return (
          <select
            value={String(filter.value)}
            onChange={(e) => onChange({ value: e.target.value })}
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white"
          >
            <option value="">Seleccionar...</option>
            {budgetOptions.map((b) => (
              <option key={b} value={b}>
                {budgetLabels[b] ?? b}
              </option>
            ))}
          </select>
        );

      default:
        return (
          <input
            type="text"
            value={String(filter.value)}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder="Valor"
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white placeholder-gray-500"
          />
        );
    }
  };

  return (
    <div className="flex items-center gap-2">
      <select
        value={filter.field}
        onChange={(e) => onChange({ field: e.target.value, value: "" })}
        className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white"
      >
        {builderFieldOptions.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <select
        value={filter.operator}
        onChange={(e) =>
          onChange({
            operator: e.target.value as SegmentFilter["operator"],
          })
        }
        className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white"
      >
        {builderOperatorOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {renderValueInput()}
      <button
        onClick={onRemove}
        className="text-xs text-red-400 hover:text-red-300"
      >
        x
      </button>
    </div>
  );
}
