"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type CoachingType = "negotiation" | "retention" | "upsell";

type Tactic = {
  name: string;
  description: string;
  example: string;
  riskLevel: "low" | "medium" | "high";
};

type CoachingResult = {
  id: string;
  situationAssessment: string;
  fanProfile: string;
  currentLeverage: string;
  risks: string[];
  tactics: Tactic[];
  suggestedNextMove: string;
  avoidList: string[];
  tokensUsed: number;
  createdAt: Date;
};

type Props = {
  conversationId: string;
  onClose: () => void;
};

const COACHING_TYPES: { value: CoachingType; label: string; description: string; icon: string }[] = [
  {
    value: "negotiation",
    label: "Negociacion",
    description: "Pricing, exclusividad, value framing",
    icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    value: "retention",
    label: "Retencion",
    description: "Re-engagement, lealtad, recuperacion",
    icon: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z",
  },
  {
    value: "upsell",
    label: "Upsell",
    description: "Tier superior, contenido premium",
    icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
  },
];

const riskColors: Record<string, string> = {
  low: "bg-green-500/20 text-green-300 border-green-500/40",
  medium: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  high: "bg-red-500/20 text-red-300 border-red-500/40",
};

const riskLabels: Record<string, string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
};

export function CoachingPanel({ conversationId, onClose }: Props) {
  const [coachingType, setCoachingType] = useState<CoachingType>("negotiation");
  const [result, setResult] = useState<CoachingResult | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedTactic, setExpandedTactic] = useState<number | null>(null);

  const coachingMutation = trpc.ai.getCoaching.useMutation({
    onSuccess: (data) => {
      setResult({
        id: data.id,
        situationAssessment: data.situationAssessment,
        fanProfile: data.fanProfile,
        currentLeverage: data.currentLeverage,
        risks: data.risks,
        tactics: data.tactics as Tactic[],
        suggestedNextMove: data.suggestedNextMove,
        avoidList: data.avoidList,
        tokensUsed: data.tokensUsed,
        createdAt: data.createdAt,
      });
    },
  });

  const historyQuery = trpc.ai.listCoachingSessions.useQuery(
    { conversationId },
    { enabled: showHistory }
  );

  function handleAnalyze() {
    setResult(null);
    coachingMutation.mutate({ conversationId, coachingType });
  }

  function loadSession(session: NonNullable<typeof historyQuery.data>[number]) {
    const analysis = session.analysis as Record<string, unknown>;
    setResult({
      id: session.id,
      situationAssessment: String(analysis.situationAssessment ?? ""),
      fanProfile: String(analysis.fanProfile ?? ""),
      currentLeverage: String(analysis.currentLeverage ?? ""),
      risks: Array.isArray(analysis.risks) ? analysis.risks.map(String) : [],
      tactics: Array.isArray(analysis.tactics)
        ? (analysis.tactics as Tactic[])
        : [],
      suggestedNextMove: String(analysis.suggestedNextMove ?? ""),
      avoidList: Array.isArray(analysis.avoidList) ? analysis.avoidList.map(String) : [],
      tokensUsed: session.tokensUsed,
      createdAt: session.createdAt,
    });
    setShowHistory(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="relative mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <h3 className="text-base font-semibold text-white">Coaching IA</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                showHistory
                  ? "border-indigo-500 bg-indigo-500/10 text-indigo-400"
                  : "border-gray-600 text-gray-400 hover:text-white"
              )}
            >
              Historial
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1 text-gray-400 hover:text-white"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {showHistory ? (
            <div className="space-y-2">
              <p className="mb-3 text-sm text-gray-400">Sesiones anteriores</p>
              {historyQuery.isLoading && (
                <p className="text-sm text-gray-500">Cargando...</p>
              )}
              {historyQuery.data?.length === 0 && (
                <p className="text-sm text-gray-500">No hay sesiones anteriores</p>
              )}
              {historyQuery.data?.map((session) => (
                <button
                  key={session.id}
                  onClick={() => loadSession(session)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 p-3 text-left transition-colors hover:border-gray-600"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white capitalize">
                      {session.coachingType}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(session.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400 line-clamp-2">
                    {String((session.analysis as Record<string, unknown>)?.situationAssessment ?? "")}
                  </p>
                </button>
              ))}
            </div>
          ) : !result ? (
            <div className="space-y-6">
              {/* Type selector */}
              <div>
                <p className="mb-3 text-sm text-gray-400">
                  Selecciona el tipo de coaching
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {COACHING_TYPES.map((type) => (
                    <button
                      key={type.value}
                      onClick={() => setCoachingType(type.value)}
                      className={cn(
                        "flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors",
                        coachingType === type.value
                          ? "border-indigo-500 bg-indigo-500/10 text-white"
                          : "border-gray-700 text-gray-400 hover:border-gray-600 hover:text-white"
                      )}
                    >
                      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={type.icon} />
                      </svg>
                      <span className="text-sm font-medium">{type.label}</span>
                      <span className="text-[11px] text-gray-500">{type.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Analyze button */}
              <button
                onClick={handleAnalyze}
                disabled={coachingMutation.isPending}
                className="w-full rounded-lg bg-indigo-600 px-5 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {coachingMutation.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Analizando conversacion...
                  </span>
                ) : (
                  "Analizar"
                )}
              </button>

              {coachingMutation.isError && (
                <p className="text-sm text-red-400">
                  {coachingMutation.error.message}
                </p>
              )}
            </div>
          ) : (
            /* Results */
            <div className="space-y-5">
              {/* Assessment */}
              <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-400">
                  Evaluacion de la situacion
                </h4>
                <p className="text-sm text-gray-200">{result.situationAssessment}</p>
              </div>

              {/* Fan profile + Leverage */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
                  <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-400">
                    Perfil del fan
                  </h4>
                  <p className="text-sm text-gray-200">{result.fanProfile}</p>
                </div>
                <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
                  <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-400">
                    Palancas actuales
                  </h4>
                  <p className="text-sm text-gray-200">{result.currentLeverage}</p>
                </div>
              </div>

              {/* Next move */}
              <div className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 p-4">
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-indigo-300">
                  Siguiente movimiento sugerido
                </h4>
                <p className="text-sm text-white">{result.suggestedNextMove}</p>
              </div>

              {/* Tactics */}
              <div>
                <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">
                  Tacticas recomendadas
                </h4>
                <div className="space-y-2">
                  {result.tactics.map((tactic, i) => (
                    <div key={i} className="rounded-lg border border-gray-700 bg-gray-800">
                      <button
                        onClick={() => setExpandedTactic(expandedTactic === i ? null : i)}
                        className="flex w-full items-center justify-between p-3 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white">{tactic.name}</span>
                          <span className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                            riskColors[tactic.riskLevel] ?? riskColors.medium
                          )}>
                            Riesgo {riskLabels[tactic.riskLevel] ?? "Medio"}
                          </span>
                        </div>
                        <svg className={cn("h-4 w-4 text-gray-500 transition-transform", expandedTactic === i && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {expandedTactic === i && (
                        <div className="border-t border-gray-700 px-3 pb-3 pt-2">
                          <p className="mb-2 text-sm text-gray-300">{tactic.description}</p>
                          <div className="rounded border border-gray-600 bg-gray-900 p-2">
                            <p className="text-xs text-gray-500">Ejemplo:</p>
                            <p className="mt-1 text-sm italic text-gray-300">&ldquo;{tactic.example}&rdquo;</p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Risks + Avoid */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {result.risks.length > 0 && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
                    <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-red-300">
                      Riesgos
                    </h4>
                    <ul className="space-y-1">
                      {result.risks.map((r, i) => (
                        <li key={i} className="text-sm text-gray-300">• {r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.avoidList.length > 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                    <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-amber-300">
                      Evitar
                    </h4>
                    <ul className="space-y-1">
                      {result.avoidList.map((a, i) => (
                        <li key={i} className="text-sm text-gray-300">• {a}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Tokens */}
              <p className="text-right text-[11px] text-gray-600">
                {result.tokensUsed} tokens usados
              </p>

              {/* New analysis button */}
              <button
                onClick={() => setResult(null)}
                className="w-full rounded-lg border border-gray-700 px-5 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white"
              >
                Nuevo analisis
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
