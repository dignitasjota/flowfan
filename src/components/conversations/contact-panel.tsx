"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/toast";

type Contact = {
  id: string;
  username: string;
  displayName: string | null;
  platformType: string;
  firstInteractionAt: Date;
  totalConversations: number;
  tags: string[] | null;
  profile: {
    engagementLevel: number;
    funnelStage: string;
    paymentProbability: number;
    estimatedBudget: string | null;
    responseSpeed: string | null;
    conversationDepth: string | null;
  } | null;
};

const funnelLabels: Record<string, string> = {
  cold: "Frio",
  curious: "Curioso",
  interested: "Interesado",
  hot_lead: "Comprador potencial",
  buyer: "Comprador",
  vip: "VIP",
};

const funnelColors: Record<string, string> = {
  cold: "text-gray-400",
  curious: "text-blue-400",
  interested: "text-yellow-400",
  hot_lead: "text-orange-400",
  buyer: "text-green-400",
  vip: "text-purple-400",
};

type Props = {
  contact: Contact;
  conversationId?: string;
  onBack?: () => void;
};

export function ContactPanel({ contact, conversationId, onBack }: Props) {
  const profile = contact.profile;

  const { data: scoring } = trpc.intelligence.getContactScoring.useQuery(
    { contactId: contact.id },
    { enabled: !!contact.id }
  );

  const { data: sentimentTrend } = trpc.intelligence.getSentimentTrend.useQuery(
    { conversationId: conversationId! },
    { enabled: !!conversationId }
  );

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const { success: toastSuccess } = useToast();
  const utils = trpc.useUtils();

  const deleteContact = trpc.contacts.delete.useMutation({
    onSuccess: (result) => {
      utils.conversations.list.invalidate();
      utils.contacts.list.invalidate();
      setDeleteTarget(null);
      if (result.action === "archived") {
        toastSuccess("Este contacto ha pagado anteriormente. Se ha archivado en lugar de eliminarlo.");
      } else {
        toastSuccess("Contacto eliminado correctamente");
      }
      if (onBack) {
        onBack();
      } else {
        window.location.href = "/conversations";
      }
    },
  });

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Back button (mobile) */}
      {onBack && (
        <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-3 lg:hidden">
          <button
            onClick={onBack}
            className="rounded-lg p-1 text-gray-400 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-medium text-white">Perfil del contacto</span>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-gray-800 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-700 text-lg font-bold text-white">
            {contact.username[0]?.toUpperCase()}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              {contact.displayName || contact.username}
            </h3>
            <p className="text-xs text-gray-400">
              @{contact.username} · {contact.platformType}
            </p>
          </div>
        </div>
      </div>

      {/* Conversation Mode (OnlyFans only) */}
      {contact.platformType === "onlyfans" && (
        <ConversationModeBadge contactId={contact.id} />
      )}

      {/* Score */}
      {profile && (
        <div className="border-b border-gray-800 px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
              Probabilidad de pago
            </span>
            <span className="text-2xl font-bold text-white">
              {scoring?.paymentProbability ?? profile.paymentProbability}%
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2 rounded-full bg-gray-800">
            <div
              className={cn(
                "h-2 rounded-full transition-all",
                (scoring?.paymentProbability ?? profile.paymentProbability) >= 70
                  ? "bg-green-500"
                  : (scoring?.paymentProbability ?? profile.paymentProbability) >= 40
                    ? "bg-yellow-500"
                    : "bg-gray-500"
              )}
              style={{ width: `${scoring?.paymentProbability ?? profile.paymentProbability}%` }}
            />
          </div>

          <p
            className={cn(
              "mt-2 text-sm font-medium",
              funnelColors[scoring?.funnelStage ?? profile.funnelStage] ?? "text-gray-400"
            )}
          >
            {funnelLabels[scoring?.funnelStage ?? profile.funnelStage] ?? profile.funnelStage}
          </p>
        </div>
      )}

      {/* Scoring Factors */}
      {scoring?.factors && scoring.factors.length > 0 && (
        <div className="border-b border-gray-800 px-4 py-4">
          <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">
            Factores de scoring
          </h4>
          <div className="space-y-2">
            {scoring.factors.map((factor) => (
              <div key={factor.label}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">{factor.label}</span>
                  <span className="text-gray-300">{Math.round(factor.value)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-gray-800">
                  <div
                    className="h-1.5 rounded-full bg-blue-500/70 transition-all"
                    style={{ width: `${Math.min(factor.value, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sentiment Trend Sparkline */}
      {sentimentTrend && sentimentTrend.length >= 2 && (
        <div className="border-b border-gray-800 px-4 py-4">
          <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">
            Tendencia de sentimiento
          </h4>
          <SentimentSparkline
            data={sentimentTrend.map((s) => s.sentiment.score)}
          />
        </div>
      )}

      {/* Topics / Interests */}
      {scoring?.behavioralSignals && (
        (() => {
          const signals = scoring.behavioralSignals as {
            topicFrequency?: Record<string, number>;
          };
          const topics = signals.topicFrequency
            ? Object.entries(signals.topicFrequency)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5)
            : [];
          if (topics.length === 0) return null;
          return (
            <div className="border-b border-gray-800 px-4 py-4">
              <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">
                Temas / Intereses
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {topics.map(([topic, count]) => (
                  <span
                    key={topic}
                    className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs text-blue-300"
                  >
                    {topic}
                    {count > 1 && (
                      <span className="ml-1 text-blue-400/60">{count}</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          );
        })()
      )}

      {/* Scoring History Chart */}
      {scoring?.scoringHistory && (scoring.scoringHistory as unknown[]).length >= 2 && (
        <div className="border-b border-gray-800 px-4 py-4">
          <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">
            Evolucion de scores
          </h4>
          <ScoringHistoryChart
            data={
              (scoring.scoringHistory as { timestamp: string; engagementLevel: number; paymentProbability: number }[])
            }
          />
          <div className="mt-2 flex gap-4 text-xs">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-blue-400" />
              Engagement
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
              Prob. pago
            </span>
          </div>
        </div>
      )}

      {/* Signals */}
      {profile && (
        <div className="border-b border-gray-800 px-4 py-4">
          <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">
            Senales
          </h4>
          <div className="space-y-2">
            <InfoRow
              label="Engagement"
              value={`${scoring?.engagementLevel ?? profile.engagementLevel}/100`}
            />
            <InfoRow
              label="Velocidad de respuesta"
              value={scoring?.responseSpeed ?? profile.responseSpeed ?? "—"}
            />
            <InfoRow
              label="Profundidad"
              value={scoring?.conversationDepth ?? profile.conversationDepth ?? "—"}
            />
            <InfoRow
              label="Presupuesto estimado"
              value={scoring?.estimatedBudget ?? profile.estimatedBudget ?? "—"}
            />
          </div>
        </div>
      )}

      {/* Revenue */}
      <RevenueSection contactId={contact.id} />

      {/* Price Advice & Report */}
      {profile && (
        <PriceAndReport contactId={contact.id} />
      )}

      {/* Info */}
      <div className="px-4 py-4">
        <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">
          Informacion
        </h4>
        <div className="space-y-2">
          <InfoRow
            label="Primera interaccion"
            value={new Date(contact.firstInteractionAt).toLocaleDateString(
              "es-ES"
            )}
          />
          <InfoRow
            label="Conversaciones"
            value={String(contact.totalConversations)}
          />
          {scoring?.scoringHistory && (scoring.scoringHistory as unknown[]).length > 0 && (
            <InfoRow
              label="Ultima actualizacion"
              value={
                new Date(
                  (scoring.scoringHistory as { timestamp: string }[]).at(-1)?.timestamp ?? ""
                ).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })
              }
            />
          )}
          {contact.tags && contact.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {contact.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-300"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete Action */}
      <div className="border-t border-gray-800 p-4">
        <button
          onClick={() => setDeleteTarget(contact.id)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-900/50 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/20"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Eliminar Contacto
        </button>
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="mx-4 w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-white">
              Eliminar contacto
            </h3>
            <p className="mt-2 text-sm text-gray-400">
              ¿Estás seguro de que quieres eliminar a{" "}
              <span className="font-medium text-white">@{contact.username}</span>?
              Se eliminarán todas sus conversaciones, mensajes y notas.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Si el contacto ha realizado algún pago, se archivará en lugar de eliminarse.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
              >
                Cancelar
              </button>
              <button
                onClick={() => deleteContact.mutate({ id: contact.id })}
                disabled={deleteContact.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteContact.isPending ? "Eliminando..." : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportContent({ data }: { data: { overview: string; patterns: string[]; funnelPrediction: { nextStage: string; probability: number; timeframe: string }; riskLevel: string; recommendations: string[] } }) {
  const riskColors: Record<string, string> = {
    low: "text-green-400",
    medium: "text-yellow-400",
    high: "text-red-400",
  };

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-gray-300">{data.overview}</p>

      {data.patterns.length > 0 && (
        <div>
          <span className="text-[10px] font-medium uppercase text-gray-500">Patrones</span>
          <ul className="mt-1 space-y-0.5">
            {data.patterns.map((p, i) => (
              <li key={i} className="text-xs text-gray-400">• {p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between rounded bg-gray-800/50 p-2">
        <div>
          <span className="text-[10px] font-medium uppercase text-gray-500">Prediccion</span>
          <p className="text-xs text-gray-300">
            {data.funnelPrediction.nextStage} ({data.funnelPrediction.probability}%)
          </p>
          <p className="text-[10px] text-gray-500">{data.funnelPrediction.timeframe}</p>
        </div>
        <div className="text-right">
          <span className="text-[10px] font-medium uppercase text-gray-500">Riesgo</span>
          <p className={cn("text-sm font-medium", riskColors[data.riskLevel])}>
            {data.riskLevel === "low" ? "Bajo" : data.riskLevel === "medium" ? "Medio" : "Alto"}
          </p>
        </div>
      </div>

      {data.recommendations.length > 0 && (
        <div>
          <span className="text-[10px] font-medium uppercase text-gray-500">Recomendaciones</span>
          <ul className="mt-1 space-y-0.5">
            {data.recommendations.map((r, i) => (
              <li key={i} className="text-xs text-green-400/80">• {r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ReportModal({ reportId, onClose }: { reportId: string; onClose: () => void }) {
  const { data, isLoading } = trpc.ai.getReport.useQuery({ reportId });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-white">
            Informe — {data ? new Date(data.createdAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "..."}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            ✕
          </button>
        </div>
        {isLoading && <p className="text-xs text-gray-500">Cargando...</p>}
        {data && (
          <>
            {data.modelUsed && (
              <p className="mb-3 text-[10px] text-gray-600">Modelo: {data.modelUsed}</p>
            )}
            <ReportContent data={data.reportData as { overview: string; patterns: string[]; funnelPrediction: { nextStage: string; probability: number; timeframe: string }; riskLevel: string; recommendations: string[] }} />
          </>
        )}
      </div>
    </div>
  );
}

function PriceAndReport({ contactId }: { contactId: string }) {
  const [showReport, setShowReport] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const priceAdvice = trpc.ai.getPriceAdvice.useMutation();
  const report = trpc.ai.generateReport.useMutation();
  const reportsList = trpc.ai.listReports.useQuery({ contactId });

  const timingColors: Record<string, string> = {
    now: "text-green-400",
    soon: "text-yellow-400",
    wait: "text-gray-400",
  };
  const timingLabels: Record<string, string> = {
    now: "Ahora",
    soon: "Pronto",
    wait: "Esperar",
  };

  return (
    <>
      {/* Price Advice */}
      <div className="border-b border-gray-800 px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wider text-gray-400">
            Recomendacion de precio
          </h4>
          <button
            onClick={() => priceAdvice.mutate({ contactId })}
            disabled={priceAdvice.isPending}
            className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
          >
            {priceAdvice.isPending ? "Analizando..." : "Analizar"}
          </button>
        </div>

        {priceAdvice.data && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Precio sugerido</span>
              <span className="text-lg font-bold text-white">
                ${priceAdvice.data.recommendedPrice}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Rango</span>
              <span className="text-sm text-gray-300">
                ${priceAdvice.data.priceRange.min} - ${priceAdvice.data.priceRange.max}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Momento</span>
              <span className={cn("text-sm font-medium", timingColors[priceAdvice.data.timing])}>
                {timingLabels[priceAdvice.data.timing]}
              </span>
            </div>
            <p className="text-xs text-gray-500">{priceAdvice.data.timingReason}</p>
            <p className="rounded bg-gray-800/50 p-2 text-xs text-gray-300">
              {priceAdvice.data.strategy}
            </p>
          </div>
        )}

        {!priceAdvice.data && !priceAdvice.isPending && (
          <p className="text-xs text-gray-600">Pulsa "Analizar" para obtener una recomendacion</p>
        )}
      </div>

      {/* Contact Report */}
      <div className="border-b border-gray-800 px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wider text-gray-400">
            Informe IA
          </h4>
          <button
            onClick={() => {
              report.mutate({ contactId }, {
                onSuccess: () => {
                  reportsList.refetch();
                },
              });
              setShowReport(true);
            }}
            disabled={report.isPending}
            className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
          >
            {report.isPending ? "Generando..." : "Generar"}
          </button>
        </div>

        {showReport && report.data && (
          <ReportContent data={report.data} />
        )}

        {!report.data && !report.isPending && (
          <p className="text-xs text-gray-600">Pulsa "Generar" para un informe completo del contacto</p>
        )}

        {/* Report History */}
        {reportsList.data && reportsList.data.length > 0 && (
          <div className="mt-4 border-t border-gray-800 pt-3">
            <span className="text-[10px] font-medium uppercase text-gray-500">
              Informes anteriores ({reportsList.data.length})
            </span>
            <ul className="mt-2 space-y-1">
              {[...reportsList.data].reverse().map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => setSelectedReportId(r.id)}
                    className="w-full rounded px-2 py-1.5 text-left text-xs text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
                  >
                    {new Date(r.createdAt).toLocaleDateString("es-ES", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {selectedReportId && (
        <ReportModal reportId={selectedReportId} onClose={() => setSelectedReportId(null)} />
      )}
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-sm text-white">{value}</span>
    </div>
  );
}

function ScoringHistoryChart({
  data,
}: {
  data: { timestamp: string; engagementLevel: number; paymentProbability: number }[];
}) {
  if (data.length < 2) return null;

  const width = 200;
  const height = 60;
  const padding = 4;

  function toPoints(values: number[]) {
    const max = 100;
    return values
      .map((v, i) => {
        const x = padding + (i / (values.length - 1)) * (width - padding * 2);
        const y = height - padding - (v / max) * (height - padding * 2);
        return `${x},${y}`;
      })
      .join(" ");
  }

  const engagementPoints = toPoints(data.map((d) => d.engagementLevel));
  const paymentPoints = toPoints(data.map((d) => d.paymentProbability));

  return (
    <svg width={width} height={height} className="w-full" viewBox={`0 0 ${width} ${height}`}>
      {/* Grid lines */}
      {[0, 25, 50, 75, 100].map((v) => {
        const y = height - padding - (v / 100) * (height - padding * 2);
        return (
          <line
            key={v}
            x1={padding}
            y1={y}
            x2={width - padding}
            y2={y}
            stroke="#1f2937"
            strokeWidth={1}
          />
        );
      })}
      {/* Engagement line */}
      <polyline
        fill="none"
        stroke="#60a5fa"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={engagementPoints}
      />
      {/* Payment probability line */}
      <polyline
        fill="none"
        stroke="#4ade80"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={paymentPoints}
      />
    </svg>
  );
}

const txTypeLabels: Record<string, string> = {
  tip: "Propina",
  ppv: "PPV",
  subscription: "Suscripción",
  custom: "Otro",
};

const txTypeColors: Record<string, string> = {
  tip: "bg-green-500/20 text-green-400",
  ppv: "bg-purple-500/20 text-purple-400",
  subscription: "bg-blue-500/20 text-blue-400",
  custom: "bg-gray-500/20 text-gray-400",
};

function RevenueSection({ contactId }: { contactId: string }) {
  const [showForm, setShowForm] = useState(false);
  const [txType, setTxType] = useState<"tip" | "ppv" | "subscription" | "custom">("tip");
  const [txAmount, setTxAmount] = useState("");
  const [txDesc, setTxDesc] = useState("");

  const summary = trpc.revenue.getContactSummary.useQuery(
    { contactId },
    { retry: false }
  );

  const createTx = trpc.revenue.create.useMutation({
    onSuccess: () => {
      summary.refetch();
      setShowForm(false);
      setTxAmount("");
      setTxDesc("");
    },
  });

  // Si el plan no lo permite, no mostrar nada
  if (summary.error?.data?.code === "FORBIDDEN") return null;

  return (
    <div className="border-b border-gray-800 px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wider text-gray-400">
          Revenue
        </h4>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-xs text-indigo-400 hover:text-indigo-300"
        >
          {showForm ? "Cancelar" : "+ Registrar"}
        </button>
      </div>

      {/* Total */}
      {summary.data && (
        <>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-gray-400">Total</span>
            <span className="text-lg font-bold text-white">
              {summary.data.totalEur.toFixed(2)}€
            </span>
          </div>

          {/* Por tipo */}
          {summary.data.byType.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {summary.data.byType.map((t) => (
                <span
                  key={t.type}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs",
                    txTypeColors[t.type] ?? "bg-gray-800 text-gray-400"
                  )}
                >
                  {txTypeLabels[t.type] ?? t.type}: {t.totalEur.toFixed(2)}€
                </span>
              ))}
            </div>
          )}

          {summary.data.transactionCount === 0 && !showForm && (
            <p className="text-xs text-gray-600">Sin transacciones registradas</p>
          )}
        </>
      )}

      {/* Formulario inline */}
      {showForm && (
        <div className="space-y-2 rounded-lg bg-gray-800/50 p-3">
          <select
            value={txType}
            onChange={(e) => setTxType(e.target.value as typeof txType)}
            className="w-full rounded bg-gray-800 px-2 py-1.5 text-xs text-white border border-gray-700"
          >
            <option value="tip">Propina</option>
            <option value="ppv">PPV Unlock</option>
            <option value="subscription">Suscripción</option>
            <option value="custom">Otro</option>
          </select>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={txAmount}
            onChange={(e) => setTxAmount(e.target.value)}
            placeholder="Monto en EUR"
            className="w-full rounded bg-gray-800 px-2 py-1.5 text-xs text-white border border-gray-700 placeholder-gray-500"
          />
          <input
            type="text"
            value={txDesc}
            onChange={(e) => setTxDesc(e.target.value)}
            placeholder="Descripción (opcional)"
            className="w-full rounded bg-gray-800 px-2 py-1.5 text-xs text-white border border-gray-700 placeholder-gray-500"
          />
          <button
            onClick={() => {
              const amount = parseFloat(txAmount);
              if (!amount || amount <= 0) return;
              createTx.mutate({
                contactId,
                type: txType,
                amount,
                description: txDesc || undefined,
              });
            }}
            disabled={createTx.isPending || !txAmount}
            className="w-full rounded bg-indigo-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {createTx.isPending ? "Guardando..." : "Guardar"}
          </button>
        </div>
      )}
    </div>
  );
}

function SentimentSparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;

  const width = 200;
  const height = 40;
  const padding = 4;

  const min = Math.min(...data, -1);
  const max = Math.max(...data, 1);
  const range = max - min || 1;

  const points = data
    .map((v, i) => {
      const x = padding + (i / (data.length - 1)) * (width - padding * 2);
      const y = height - padding - ((v - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  // Zero line y position
  const zeroY = height - padding - ((0 - min) / range) * (height - padding * 2);

  // Color based on last value
  const lastVal = data[data.length - 1] ?? 0;
  const strokeColor = lastVal > 0.2 ? "#4ade80" : lastVal < -0.2 ? "#f87171" : "#94a3b8";

  return (
    <svg width={width} height={height} className="w-full" viewBox={`0 0 ${width} ${height}`}>
      {/* Zero line */}
      <line
        x1={padding}
        y1={zeroY}
        x2={width - padding}
        y2={zeroY}
        stroke="#374151"
        strokeWidth={1}
        strokeDasharray="4,4"
      />
      {/* Trend line */}
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
      {/* Last point dot */}
      {data.length > 0 && (() => {
        const lastX = padding + ((data.length - 1) / (data.length - 1)) * (width - padding * 2);
        const lastY = height - padding - ((lastVal - min) / range) * (height - padding * 2);
        return <circle cx={lastX} cy={lastY} r={3} fill={strokeColor} />;
      })()}
    </svg>
  );
}

const modeColors: Record<string, string> = {
  BASE: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  POTENCIAL_PREMIUM: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  CONVERSION: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  VIP: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  LOW_VALUE: "bg-red-500/20 text-red-400 border-red-500/30",
};

function ConversationModeBadge({ contactId }: { contactId: string }) {
  const { data: mode, isLoading } = trpc.conversationModes.resolveForContact.useQuery(
    { contactId }
  );

  if (isLoading) return null;
  if (!mode) return null;

  const colorClass = modeColors[mode.modeType] ?? modeColors.BASE;

  return (
    <div className="border-b border-gray-800 px-4 py-3">
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-400">
        Modo de conversacion
      </h4>
      <div className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1", colorClass)}>
        <span className="text-xs font-medium">{mode.name}</span>
      </div>
      {mode.description && (
        <p className="mt-1.5 text-xs text-gray-500">{mode.description}</p>
      )}
    </div>
  );
}
