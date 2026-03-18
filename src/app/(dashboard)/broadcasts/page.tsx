"use client";

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BroadcastStatus =
  | "draft"
  | "processing"
  | "sending"
  | "completed"
  | "failed"
  | "scheduled"
  | "cancelled";

type Broadcast = {
  id: string;
  name: string;
  content: string;
  status: BroadcastStatus;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  manualCount: number;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  segment: { name: string } | null;
};

type Segment = {
  id: string;
  name: string;
  type: string;
  contactCount: number;
};

type Recipient = {
  id: string;
  status: string;
  contact: {
    id: string;
    username: string;
    displayName: string | null;
    platformType: string;
  } | null;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const statusConfig: Record<
  BroadcastStatus,
  { label: string; classes: string }
> = {
  draft: { label: "Borrador", classes: "bg-gray-700 text-gray-300" },
  processing: {
    label: "Procesando",
    classes: "bg-blue-900/50 text-blue-400",
  },
  sending: {
    label: "Enviando",
    classes: "bg-blue-900/50 text-blue-400 animate-pulse",
  },
  completed: { label: "Completado", classes: "bg-green-900/50 text-green-400" },
  failed: { label: "Fallido", classes: "bg-red-900/50 text-red-400" },
  scheduled: {
    label: "Programado",
    classes: "bg-yellow-900/50 text-yellow-400",
  },
  cancelled: { label: "Cancelado", classes: "bg-gray-700 text-gray-500" },
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "---";
  return new Date(dateStr).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function progressPercent(sent: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((sent / total) * 100);
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function BroadcastsPage() {
  const [showWizard, setShowWizard] = useState(false);
  const [selectedBroadcast, setSelectedBroadcast] = useState<Broadcast | null>(
    null
  );

  const broadcastsList = trpc.broadcasts.list.useQuery(
    { limit: 50, offset: 0 },
    { retry: false }
  );

  const deleteMutation = trpc.broadcasts.delete.useMutation({
    onSuccess: () => {
      broadcastsList.refetch();
    },
  });

  const duplicateMutation = trpc.broadcasts.duplicate.useMutation({
    onSuccess: () => {
      broadcastsList.refetch();
    },
  });

  const cancelMutation = trpc.broadcasts.cancel.useMutation({
    onSuccess: () => {
      broadcastsList.refetch();
    },
  });

  const sendMutation = trpc.broadcasts.send.useMutation({
    onSuccess: () => {
      broadcastsList.refetch();
    },
  });

  // Plan gate
  if (broadcastsList.error?.data?.code === "FORBIDDEN") {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="text-center">
          <p className="text-lg font-medium text-white">Broadcasts</p>
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

  const broadcasts = (broadcastsList.data ?? []) as Broadcast[];

  // Stats
  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = broadcasts.filter((b) => {
      if (!b.completedAt) return false;
      const d = new Date(b.completedAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    return {
      total: broadcasts.length,
      sentThisMonth: thisMonth.length,
      totalRecipients: broadcasts.reduce((sum, b) => sum + b.totalRecipients, 0),
    };
  }, [broadcasts]);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-950 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white sm:text-2xl">
            Broadcasts
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            Envia mensajes masivos a segmentos de contactos
          </p>
        </div>
        <button
          onClick={() => setShowWizard(true)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          + Nuevo Broadcast
        </button>
      </div>

      {/* Stats bar */}
      <div className="mt-4 flex flex-wrap gap-3">
        <span className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300">
          {stats.total} broadcasts
        </span>
        <span className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300">
          {stats.sentThisMonth} enviados este mes
        </span>
        <span className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300">
          {stats.totalRecipients} recipients totales
        </span>
      </div>

      {/* Loading state */}
      {broadcastsList.isLoading && (
        <div className="mt-12 text-center">
          <p className="text-sm text-gray-500">Cargando broadcasts...</p>
        </div>
      )}

      {/* Broadcast list */}
      {!broadcastsList.isLoading && broadcasts.length > 0 && (
        <div className="mt-6 space-y-3">
          {broadcasts.map((broadcast) => (
            <div
              key={broadcast.id}
              className="rounded-xl border border-gray-800 bg-gray-900 p-4 transition-colors hover:border-gray-700"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="truncate text-sm font-semibold text-white">
                      {broadcast.name}
                    </h3>
                    <StatusBadge status={broadcast.status} />
                    {broadcast.segment && (
                      <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
                        {broadcast.segment.name}
                      </span>
                    )}
                  </div>

                  <p className="mt-1 line-clamp-1 text-xs text-gray-500">
                    {broadcast.content}
                  </p>

                  <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                    <span>
                      {broadcast.sentCount}/{broadcast.totalRecipients} enviados
                    </span>
                    {broadcast.failedCount > 0 && (
                      <span className="text-red-400">
                        {broadcast.failedCount} fallidos
                      </span>
                    )}
                    {broadcast.manualCount > 0 && (
                      <span className="text-yellow-400">
                        {broadcast.manualCount} manuales
                      </span>
                    )}
                    {broadcast.scheduledAt && (
                      <span>
                        Programado: {formatDate(broadcast.scheduledAt)}
                      </span>
                    )}
                    <span>Creado: {formatDate(broadcast.createdAt)}</span>
                  </div>

                  {/* Progress bar for active broadcasts */}
                  {(broadcast.status === "sending" ||
                    broadcast.status === "processing") && (
                    <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-gray-800">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all"
                        style={{
                          width: `${progressPercent(broadcast.sentCount, broadcast.totalRecipients)}%`,
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {/* View detail */}
                  <button
                    onClick={() => setSelectedBroadcast(broadcast)}
                    className="rounded-lg border border-gray-700 px-2.5 py-1.5 text-xs text-gray-400 hover:text-white"
                    title="Ver detalle"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                      />
                    </svg>
                  </button>

                  {/* Send (only drafts) */}
                  {broadcast.status === "draft" && (
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `¿Enviar el broadcast "${broadcast.name}" ahora?`
                          )
                        ) {
                          sendMutation.mutate({ id: broadcast.id });
                        }
                      }}
                      className="rounded-lg border border-green-800 px-2.5 py-1.5 text-xs text-green-400 hover:bg-green-900/20"
                      title="Enviar ahora"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5"
                        />
                      </svg>
                    </button>
                  )}

                  {/* Duplicate */}
                  <button
                    onClick={() =>
                      duplicateMutation.mutate({ id: broadcast.id })
                    }
                    className="rounded-lg border border-gray-700 px-2.5 py-1.5 text-xs text-gray-400 hover:text-white"
                    title="Duplicar"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75"
                      />
                    </svg>
                  </button>

                  {/* Cancel (only sending/scheduled/processing) */}
                  {(broadcast.status === "sending" ||
                    broadcast.status === "scheduled" ||
                    broadcast.status === "processing") && (
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `¿Cancelar el broadcast "${broadcast.name}"?`
                          )
                        ) {
                          cancelMutation.mutate({ id: broadcast.id });
                        }
                      }}
                      className="rounded-lg border border-yellow-800 px-2.5 py-1.5 text-xs text-yellow-400 hover:bg-yellow-900/20"
                      title="Cancelar"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636"
                        />
                      </svg>
                    </button>
                  )}

                  {/* Delete (only drafts, completed, failed, cancelled) */}
                  {(broadcast.status === "draft" ||
                    broadcast.status === "completed" ||
                    broadcast.status === "failed" ||
                    broadcast.status === "cancelled") && (
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `¿Eliminar el broadcast "${broadcast.name}"?`
                          )
                        ) {
                          deleteMutation.mutate({ id: broadcast.id });
                        }
                      }}
                      className="rounded-lg border border-red-800 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-900/20"
                      title="Eliminar"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!broadcastsList.isLoading && broadcasts.length === 0 && (
        <div className="mt-12 text-center">
          <p className="text-lg text-gray-400">Sin broadcasts</p>
          <p className="mt-1 text-sm text-gray-600">
            Crea tu primer broadcast para enviar mensajes masivos a tus fans
          </p>
          <button
            onClick={() => setShowWizard(true)}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            + Nuevo Broadcast
          </button>
        </div>
      )}

      {/* Wizard modal */}
      {showWizard && (
        <BroadcastWizard
          onClose={() => setShowWizard(false)}
          onCreated={() => {
            setShowWizard(false);
            broadcastsList.refetch();
          }}
        />
      )}

      {/* Detail modal */}
      {selectedBroadcast && (
        <BroadcastDetail
          broadcast={selectedBroadcast}
          onClose={() => setSelectedBroadcast(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: BroadcastStatus }) {
  const config = statusConfig[status] ?? {
    label: status,
    classes: "bg-gray-700 text-gray-300",
  };
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium",
        config.classes
      )}
    >
      {config.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Broadcast Wizard (3 steps)
// ---------------------------------------------------------------------------

function BroadcastWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [segmentId, setSegmentId] = useState("");
  type PlatformType = "instagram" | "tinder" | "reddit" | "onlyfans" | "twitter" | "telegram" | "snapchat" | "other";
  const [platformType, setPlatformType] = useState<PlatformType | "">("");
  const [content, setContent] = useState("");

  const segmentsList = trpc.segments.list.useQuery();
  const segments = (segmentsList.data ?? []) as Segment[];

  const previewQuery = trpc.broadcasts.previewSegment.useQuery(
    { segmentId },
    { enabled: !!segmentId }
  );

  const createMutation = trpc.broadcasts.create.useMutation({
    onSuccess: onCreated,
  });

  const sendMutation = trpc.broadcasts.send.useMutation({
    onSuccess: onCreated,
  });

  const selectedSegment = segments.find((s) => s.id === segmentId);

  const handleSaveDraft = () => {
    if (!name.trim() || !segmentId || !content.trim()) return;
    createMutation.mutate({
      name: name.trim(),
      content: content.trim(),
      segmentId,
      ...(platformType ? { platformType: platformType as PlatformType } : {}),
    });
  };

  const handleSendNow = () => {
    if (!name.trim() || !segmentId || !content.trim()) return;
    createMutation.mutate(
      {
        name: name.trim(),
        content: content.trim(),
        segmentId,
        ...(platformType ? { platformType } : {}),
      },
      {
        onSuccess: (data) => {
          if (data && typeof data === "object" && "id" in data) {
            sendMutation.mutate({ id: (data as { id: string }).id });
          }
        },
      }
    );
  };

  const insertVariable = (variable: string) => {
    setContent((prev) => prev + variable);
  };

  const previewContent = content
    .replace(/\{\{displayName\}\}/g, "Maria Garcia")
    .replace(/\{\{username\}\}/g, "maria_g");

  const canGoStep2 = !!segmentId && !!name.trim();
  const canGoStep3 = canGoStep2 && !!content.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-white">Nuevo Broadcast</h2>

        {/* Step indicator */}
        <div className="mt-4 flex items-center gap-2">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium",
                  s === step
                    ? "bg-indigo-600 text-white"
                    : s < step
                      ? "bg-indigo-500/20 text-indigo-300"
                      : "bg-gray-800 text-gray-500"
                )}
              >
                {s}
              </div>
              <span
                className={cn(
                  "text-xs",
                  s === step ? "text-white" : "text-gray-500"
                )}
              >
                {s === 1
                  ? "Segmento"
                  : s === 2
                    ? "Mensaje"
                    : "Revisar"}
              </span>
              {s < 3 && (
                <div className="mx-1 h-px w-8 bg-gray-700" />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Seleccionar segmento */}
        {step === 1 && (
          <div className="mt-6 space-y-4">
            <div>
              <label className="text-xs text-gray-500">
                Nombre del broadcast *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Promo fin de semana"
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500">Segmento *</label>
              <select
                value={segmentId}
                onChange={(e) => setSegmentId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              >
                <option value="">Seleccionar segmento...</option>
                {segments.map((seg) => (
                  <option key={seg.id} value={seg.id}>
                    {seg.name} ({seg.contactCount} contactos)
                  </option>
                ))}
              </select>
            </div>

            {segmentId && previewQuery.data && (
              <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2">
                <p className="text-xs text-indigo-300">
                  Segmento: {previewQuery.data.segmentName} &mdash;{" "}
                  {previewQuery.data.total} recipients
                </p>
              </div>
            )}

            <div>
              <label className="text-xs text-gray-500">
                Filtrar por plataforma (opcional)
              </label>
              <select
                value={platformType}
                onChange={(e) => setPlatformType(e.target.value as PlatformType | "")}
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              >
                <option value="">Todas las plataformas</option>
                {Object.entries(platformLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Step 2: Componer mensaje */}
        {step === 2 && (
          <div className="mt-6 space-y-4">
            <div>
              <label className="text-xs text-gray-500">Mensaje *</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={6}
                placeholder="Escribe tu mensaje aqui..."
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Variables:</span>
              <button
                onClick={() => insertVariable("{{displayName}}")}
                className="rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-800 hover:text-white"
              >
                {"{{displayName}}"}
              </button>
              <button
                onClick={() => insertVariable("{{username}}")}
                className="rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-800 hover:text-white"
              >
                {"{{username}}"}
              </button>
            </div>

            {/* Live preview */}
            {content.trim() && (
              <div>
                <p className="text-xs text-gray-500">Vista previa:</p>
                <div className="mt-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2">
                  <p className="whitespace-pre-wrap text-sm text-gray-200">
                    {previewContent}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Revisar y enviar */}
        {step === 3 && (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
              <h3 className="text-sm font-medium text-white">Resumen</h3>

              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Nombre:</span>
                  <span className="text-white">{name}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Segmento:</span>
                  <span className="text-white">
                    {selectedSegment?.name ?? "---"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Recipients:</span>
                  <span className="text-white">
                    {previewQuery.data?.total ?? selectedSegment?.contactCount ?? 0}
                  </span>
                </div>
                {platformType && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">Plataforma:</span>
                    <span className="text-white">
                      {platformLabels[platformType] ?? platformType}
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-4">
                <p className="text-xs text-gray-500">Mensaje:</p>
                <div className="mt-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2">
                  <p className="whitespace-pre-wrap text-sm text-gray-200">
                    {previewContent}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 flex items-center justify-between">
          <div>
            {step > 1 && (
              <button
                onClick={() => setStep((step - 1) as 1 | 2 | 3)}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-white"
              >
                Atras
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-white"
            >
              Cancelar
            </button>

            {step < 3 && (
              <button
                onClick={() => setStep((step + 1) as 1 | 2 | 3)}
                disabled={step === 1 ? !canGoStep2 : !canGoStep3}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                Siguiente
              </button>
            )}

            {step === 3 && (
              <>
                <button
                  onClick={handleSaveDraft}
                  disabled={
                    createMutation.isPending || sendMutation.isPending
                  }
                  className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:text-white disabled:opacity-50"
                >
                  {createMutation.isPending && !sendMutation.isPending
                    ? "Guardando..."
                    : "Guardar borrador"}
                </button>
                <button
                  onClick={handleSendNow}
                  disabled={
                    createMutation.isPending || sendMutation.isPending
                  }
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
                >
                  {sendMutation.isPending ? "Enviando..." : "Enviar ahora"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Broadcast Detail Modal
// ---------------------------------------------------------------------------

function BroadcastDetail({
  broadcast,
  onClose,
}: {
  broadcast: Broadcast;
  onClose: () => void;
}) {
  const [recipientPage, setRecipientPage] = useState(0);
  const RECIPIENTS_LIMIT = 20;

  const recipientsQuery = trpc.broadcasts.getRecipients.useQuery(
    {
      broadcastId: broadcast.id,
      limit: RECIPIENTS_LIMIT,
      offset: recipientPage * RECIPIENTS_LIMIT,
    },
    { retry: false }
  );

  const recipients = (recipientsQuery.data ?? []) as Recipient[];
  const progress = progressPercent(
    broadcast.sentCount,
    broadcast.totalRecipients
  );

  const recipientStatusConfig: Record<string, { label: string; classes: string }> = {
    sent: { label: "Enviado", classes: "bg-green-900/50 text-green-400" },
    pending: { label: "Pendiente", classes: "bg-gray-700 text-gray-300" },
    failed: { label: "Fallido", classes: "bg-red-900/50 text-red-400" },
    manual: { label: "Manual", classes: "bg-yellow-900/50 text-yellow-400" },
    skipped: { label: "Omitido", classes: "bg-gray-700 text-gray-500" },
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-white">
              {broadcast.name}
            </h2>
            <StatusBadge status={broadcast.status} />
          </div>
        </div>

        {/* Stats */}
        <div className="mt-4 grid grid-cols-4 gap-3">
          <div className="rounded-lg border border-gray-800 bg-gray-800/50 p-3 text-center">
            <p className="text-lg font-bold text-white">
              {broadcast.totalRecipients}
            </p>
            <p className="text-[10px] text-gray-500">Total</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-800/50 p-3 text-center">
            <p className="text-lg font-bold text-green-400">
              {broadcast.sentCount}
            </p>
            <p className="text-[10px] text-gray-500">Enviados</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-800/50 p-3 text-center">
            <p className="text-lg font-bold text-red-400">
              {broadcast.failedCount}
            </p>
            <p className="text-[10px] text-gray-500">Fallidos</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-800/50 p-3 text-center">
            <p className="text-lg font-bold text-yellow-400">
              {broadcast.manualCount}
            </p>
            <p className="text-[10px] text-gray-500">Manuales</p>
          </div>
        </div>

        {/* Progress bar */}
        {broadcast.totalRecipients > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>Progreso</span>
              <span>{progress}%</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-800">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  broadcast.status === "completed"
                    ? "bg-green-500"
                    : broadcast.status === "failed"
                      ? "bg-red-500"
                      : "bg-blue-500"
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Dates */}
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-500">
          <span>Creado: {formatDate(broadcast.createdAt)}</span>
          {broadcast.scheduledAt && (
            <span>Programado: {formatDate(broadcast.scheduledAt)}</span>
          )}
          {broadcast.startedAt && (
            <span>Iniciado: {formatDate(broadcast.startedAt)}</span>
          )}
          {broadcast.completedAt && (
            <span>Completado: {formatDate(broadcast.completedAt)}</span>
          )}
        </div>

        {/* Message content */}
        <div className="mt-4">
          <p className="text-xs text-gray-500">Mensaje:</p>
          <div className="mt-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2">
            <p className="whitespace-pre-wrap text-sm text-gray-200">
              {broadcast.content}
            </p>
          </div>
        </div>

        {/* Recipients */}
        <div className="mt-6">
          <h3 className="text-sm font-medium text-white">Recipients</h3>

          {recipientsQuery.isLoading ? (
            <div className="mt-4 text-center">
              <p className="text-sm text-gray-500">Cargando recipients...</p>
            </div>
          ) : recipients.length > 0 ? (
            <>
              <table className="mt-3 w-full">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
                    <th className="pb-2 font-medium">Username</th>
                    <th className="pb-2 font-medium">Nombre</th>
                    <th className="pb-2 font-medium">Plataforma</th>
                    <th className="pb-2 font-medium">Estado</th>
                    <th className="pb-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {recipients.map((r) => {
                    const rStatus =
                      recipientStatusConfig[r.status] ?? {
                        label: r.status,
                        classes: "bg-gray-700 text-gray-300",
                      };
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-gray-800/50"
                      >
                        <td className="py-2 text-sm text-white">
                          {r.contact?.username ?? "---"}
                        </td>
                        <td className="py-2 text-sm text-gray-300">
                          {r.contact?.displayName ?? "---"}
                        </td>
                        <td className="py-2">
                          <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-400">
                            {r.contact
                              ? platformLabels[r.contact.platformType] ??
                                r.contact.platformType
                              : "---"}
                          </span>
                        </td>
                        <td className="py-2">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-medium",
                              rStatus.classes
                            )}
                          >
                            {rStatus.label}
                          </span>
                        </td>
                        <td className="py-2 text-right">
                          {r.status === "manual" && r.contact?.username && (
                            <button
                              onClick={() =>
                                copyToClipboard(r.contact!.username)
                              }
                              className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-white"
                              title="Copiar username"
                            >
                              Copiar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              <div className="mt-3 flex items-center justify-between">
                <button
                  onClick={() =>
                    setRecipientPage(Math.max(0, recipientPage - 1))
                  }
                  disabled={recipientPage === 0}
                  className="rounded-lg border border-gray-700 px-3 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30"
                >
                  Anterior
                </button>
                <span className="text-xs text-gray-500">
                  Pagina {recipientPage + 1}
                </span>
                <button
                  onClick={() => setRecipientPage(recipientPage + 1)}
                  disabled={recipients.length < RECIPIENTS_LIMIT}
                  className="rounded-lg border border-gray-700 px-3 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30"
                >
                  Siguiente
                </button>
              </div>
            </>
          ) : (
            <div className="mt-4 text-center">
              <p className="text-sm text-gray-500">Sin recipients</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-end">
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
