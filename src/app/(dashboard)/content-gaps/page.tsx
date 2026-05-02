"use client";

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type PeriodDays = "7" | "30" | "90";

const PERIOD_OPTIONS: { value: PeriodDays; label: string }[] = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
];

const demandColors: Record<string, string> = {
  high: "bg-green-500/20 text-green-300",
  medium: "bg-amber-500/20 text-amber-300",
  low: "bg-gray-500/20 text-gray-300",
};

const demandLabels: Record<string, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

type TopicGap = {
  topic: string;
  frequency: number;
  avgSentiment: number;
  sampleQuotes: string[];
};

type DropPoint = {
  pattern: string;
  frequency: number;
  suggestion: string;
};

type ContentOpportunity = {
  title: string;
  description: string;
  estimatedDemand: string;
  estimatedRevenue: string;
};

type PlatformInsight = {
  platform: string;
  topTopics: string[];
  avgEngagement: number;
};

type ReportData = {
  topRequestedTopics: TopicGap[];
  engagementDropPoints: DropPoint[];
  contentOpportunities: ContentOpportunity[];
  platformBreakdown: PlatformInsight[];
  trendingThemes: string[];
  summary: string;
};

export default function ContentGapsPage() {
  const [periodDays, setPeriodDays] = useState<PeriodDays>("30");
  const [activeReport, setActiveReport] = useState<{
    id: string;
    data: ReportData;
    createdAt: Date;
    tokensUsed: number;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<"trends" | "report" | "history">("trends");

  const trendsQuery = trpc.contentGaps.getTopicTrends.useQuery();
  const reportsQuery = trpc.contentGaps.list.useQuery(undefined, {
    enabled: activeTab === "history",
  });

  const generateMutation = trpc.contentGaps.generate.useMutation({
    onSuccess: (data) => {
      setActiveReport({
        id: data.id,
        data: {
          topRequestedTopics: data.topRequestedTopics,
          engagementDropPoints: data.engagementDropPoints,
          contentOpportunities: data.contentOpportunities,
          platformBreakdown: data.platformBreakdown,
          trendingThemes: data.trendingThemes,
          summary: data.summary,
        },
        createdAt: data.createdAt,
        tokensUsed: data.tokensUsed,
      });
      setActiveTab("report");
    },
  });

  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const reportDetailQuery = trpc.contentGaps.get.useQuery(
    { id: selectedReportId! },
    { enabled: !!selectedReportId }
  );

  useEffect(() => {
    if (reportDetailQuery.data && selectedReportId) {
      const rd = reportDetailQuery.data.reportData as Record<string, unknown>;
      setActiveReport({
        id: reportDetailQuery.data.id,
        data: {
          topRequestedTopics: (rd.topRequestedTopics as TopicGap[]) ?? [],
          engagementDropPoints: (rd.engagementDropPoints as DropPoint[]) ?? [],
          contentOpportunities: (rd.contentOpportunities as ContentOpportunity[]) ?? [],
          platformBreakdown: (rd.platformBreakdown as PlatformInsight[]) ?? [],
          trendingThemes: (rd.trendingThemes as string[]) ?? [],
          summary: String(rd.summary ?? ""),
        },
        createdAt: reportDetailQuery.data.createdAt,
        tokensUsed: reportDetailQuery.data.tokensUsed,
      });
      setActiveTab("report");
      setSelectedReportId(null);
    }
  }, [reportDetailQuery.data, selectedReportId]);

  function sentimentColor(val: number): string {
    if (val > 0.3) return "text-green-400";
    if (val < -0.3) return "text-red-400";
    return "text-gray-400";
  }

  const tabs = [
    { id: "trends" as const, label: "Topic Trends" },
    { id: "report" as const, label: "Reporte IA" },
    { id: "history" as const, label: "Historial" },
  ];

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4">
        <h2 className="text-lg font-semibold text-white">Content Gap Analysis</h2>
        <p className="mt-1 text-sm text-gray-400">
          Identifica temas que tus fans piden y que puedes aprovechar
        </p>
      </div>

      {/* Tab navigation */}
      <div className="flex flex-shrink-0 gap-1 border-b border-gray-800 px-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "border-indigo-500 text-white"
                : "border-transparent text-gray-400 hover:text-white"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 px-6 py-6">
        {activeTab === "trends" && (
          <div className="max-w-4xl space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">
                Temas mas discutidos
              </h3>
              <span className="text-xs text-gray-500">Sin coste IA</span>
            </div>

            {trendsQuery.isLoading && (
              <p className="text-sm text-gray-500">Cargando tendencias...</p>
            )}

            {trendsQuery.data?.length === 0 && (
              <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
                <p className="text-sm text-gray-400">
                  No hay datos de temas todavia. Los temas se extraen automaticamente
                  al analizar mensajes de tus contactos.
                </p>
              </div>
            )}

            {trendsQuery.data && trendsQuery.data.length > 0 && (
              <div className="space-y-2">
                {trendsQuery.data.map((trend, i) => {
                  const maxFreq = trendsQuery.data[0]?.frequency ?? 1;
                  const pct = Math.round((trend.frequency / maxFreq) * 100);
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-4 rounded-lg border border-gray-800 bg-gray-900 p-3"
                    >
                      <span className="w-6 text-right text-xs font-medium text-gray-500">
                        {i + 1}
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-white">
                            {trend.topic}
                          </span>
                          <div className="flex items-center gap-3">
                            <span className={cn("text-xs", sentimentColor(trend.avgSentiment))}>
                              {trend.avgSentiment > 0 ? "+" : ""}{trend.avgSentiment.toFixed(2)}
                            </span>
                            <span className="text-xs text-gray-500">
                              {trend.frequency} menciones
                            </span>
                          </div>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-800">
                          <div
                            className="h-1.5 rounded-full bg-indigo-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Generate report CTA */}
            <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">
                    Generar reporte con IA
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    Analisis profundo de gaps, oportunidades y recomendaciones (requiere plan Pro+)
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={periodDays}
                    onChange={(e) => setPeriodDays(e.target.value as PeriodDays)}
                    className="rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                  >
                    {PERIOD_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => generateMutation.mutate({ periodDays })}
                    disabled={generateMutation.isPending}
                    className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {generateMutation.isPending ? "Generando..." : "Generar reporte"}
                  </button>
                </div>
              </div>
              {generateMutation.isError && (
                <p className="mt-2 text-sm text-red-400">{generateMutation.error.message}</p>
              )}
            </div>
          </div>
        )}

        {activeTab === "report" && (
          <div className="max-w-4xl space-y-6">
            {!activeReport ? (
              <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
                <p className="text-sm text-gray-400">
                  No hay reporte activo. Genera uno desde la pestana &quot;Topic Trends&quot;
                  o selecciona uno del historial.
                </p>
              </div>
            ) : (
              <>
                {/* Summary */}
                <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-5">
                  <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-indigo-300">
                    Resumen ejecutivo
                  </h4>
                  <p className="text-sm text-gray-200">{activeReport.data.summary}</p>
                </div>

                {/* Trending themes */}
                {activeReport.data.trendingThemes.length > 0 && (
                  <div>
                    <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">
                      Temas emergentes
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {activeReport.data.trendingThemes.map((theme, i) => (
                        <span
                          key={i}
                          className="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-3 py-1 text-sm text-indigo-300"
                        >
                          {theme}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Top requested topics */}
                {activeReport.data.topRequestedTopics.length > 0 && (
                  <div>
                    <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">
                      Temas mas solicitados
                    </h4>
                    <div className="space-y-2">
                      {activeReport.data.topRequestedTopics.map((topic, i) => (
                        <div
                          key={i}
                          className="rounded-lg border border-gray-700 bg-gray-800 p-4"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-white">
                              {topic.topic}
                            </span>
                            <div className="flex items-center gap-3">
                              <span className={cn("text-xs", sentimentColor(topic.avgSentiment))}>
                                Sentimiento: {topic.avgSentiment > 0 ? "+" : ""}{topic.avgSentiment.toFixed(2)}
                              </span>
                              <span className="text-xs text-gray-500">
                                {topic.frequency} menciones
                              </span>
                            </div>
                          </div>
                          {topic.sampleQuotes.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {topic.sampleQuotes.map((q, j) => (
                                <p key={j} className="text-xs italic text-gray-400">
                                  &ldquo;{q}&rdquo;
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Content opportunities */}
                {activeReport.data.contentOpportunities.length > 0 && (
                  <div>
                    <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">
                      Oportunidades de contenido
                    </h4>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {activeReport.data.contentOpportunities.map((opp, i) => (
                        <div
                          key={i}
                          className="rounded-lg border border-gray-700 bg-gray-800 p-4"
                        >
                          <h5 className="text-sm font-medium text-white">{opp.title}</h5>
                          <p className="mt-1 text-xs text-gray-400">{opp.description}</p>
                          <div className="mt-3 flex gap-2">
                            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", demandColors[opp.estimatedDemand] ?? demandColors.medium)}>
                              Demanda: {demandLabels[opp.estimatedDemand] ?? "Media"}
                            </span>
                            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", demandColors[opp.estimatedRevenue] ?? demandColors.medium)}>
                              Revenue: {demandLabels[opp.estimatedRevenue] ?? "Medio"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Engagement drop points */}
                {activeReport.data.engagementDropPoints.length > 0 && (
                  <div>
                    <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">
                      Puntos de perdida de engagement
                    </h4>
                    <div className="space-y-2">
                      {activeReport.data.engagementDropPoints.map((dp, i) => (
                        <div
                          key={i}
                          className="rounded-lg border border-red-500/20 bg-red-500/5 p-4"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-white">{dp.pattern}</span>
                            <span className="text-xs text-gray-500">{dp.frequency} contactos</span>
                          </div>
                          <p className="mt-1 text-xs text-gray-400">{dp.suggestion}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Platform breakdown */}
                {activeReport.data.platformBreakdown.length > 0 && (
                  <div>
                    <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">
                      Desglose por plataforma
                    </h4>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {activeReport.data.platformBreakdown.map((pb, i) => (
                        <div
                          key={i}
                          className="rounded-lg border border-gray-700 bg-gray-800 p-4"
                        >
                          <h5 className="text-sm font-medium text-white capitalize">
                            {pb.platform}
                          </h5>
                          <p className="mt-1 text-xs text-gray-500">
                            Engagement promedio: {pb.avgEngagement}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {pb.topTopics.map((t, j) => (
                              <span
                                key={j}
                                className="rounded-full bg-gray-700 px-2 py-0.5 text-[10px] text-gray-300"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Meta info */}
                <p className="text-right text-[11px] text-gray-600">
                  Generado el {new Date(activeReport.createdAt).toLocaleString()} — {activeReport.tokensUsed} tokens
                </p>
              </>
            )}
          </div>
        )}

        {activeTab === "history" && (
          <div className="max-w-4xl space-y-4">
            <h3 className="text-base font-semibold text-white">
              Reportes anteriores
            </h3>

            {reportsQuery.isLoading && (
              <p className="text-sm text-gray-500">Cargando...</p>
            )}

            {reportsQuery.data?.length === 0 && (
              <p className="text-sm text-gray-500">No hay reportes anteriores</p>
            )}

            {reportsQuery.data?.map((report) => (
              <button
                key={report.id}
                onClick={() => setSelectedReportId(report.id)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 p-4 text-left transition-colors hover:border-gray-600"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">
                    Reporte {new Date(report.createdAt).toLocaleDateString()}
                  </span>
                  <span className="text-xs text-gray-500">
                    {report.modelUsed}
                  </span>
                </div>
                <div className="mt-1 flex gap-4 text-xs text-gray-400">
                  <span>{report.contactsAnalyzed} contactos</span>
                  <span>{report.messagesAnalyzed} mensajes</span>
                  <span>
                    {new Date(report.periodStart).toLocaleDateString()} - {new Date(report.periodEnd).toLocaleDateString()}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
