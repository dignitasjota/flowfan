"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { TrendChart } from "@/components/ui/trend-chart";

const typeLabels: Record<string, string> = {
  tip: "Propinas",
  ppv: "PPV",
  subscription: "Suscripciones",
  custom: "Otros",
};

const typeColors: Record<string, string> = {
  tip: "bg-green-500",
  ppv: "bg-purple-500",
  subscription: "bg-blue-500",
  custom: "bg-gray-500",
};

export default function RevenuePage() {
  const [trendPeriod, setTrendPeriod] = useState<"daily" | "weekly" | "monthly">("daily");

  const stats = trpc.revenue.getDashboardStats.useQuery(undefined, { retry: false });
  const trend = trpc.revenue.getRevenueTrend.useQuery({ period: trendPeriod }, { retry: false });
  const topSpenders = trpc.revenue.getTopSpenders.useQuery({ limit: 10 }, { retry: false });
  const roiRanking = trpc.revenue.getROIRanking.useQuery({ limit: 10 }, { retry: false });

  // Plan no lo permite
  if (stats.error?.data?.code === "FORBIDDEN") {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="text-center">
          <p className="text-lg font-medium text-white">Revenue Tracking</p>
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

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
      <h1 className="text-xl font-bold text-white sm:text-2xl">Revenue</h1>
      <p className="mt-1 text-sm text-gray-400">Tracking de ingresos por fan</p>

      {/* KPI Cards */}
      {stats.data && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <KpiCard label="Total" value={`${stats.data.totalRevenueEur.toFixed(2)}€`} />
          <KpiCard label="Este mes" value={`${stats.data.thisMonthEur.toFixed(2)}€`} />
          <KpiCard
            label="vs mes anterior"
            value={`${stats.data.growthPercent >= 0 ? "+" : ""}${stats.data.growthPercent}%`}
            valueColor={
              stats.data.growthPercent > 0
                ? "text-green-400"
                : stats.data.growthPercent < 0
                  ? "text-red-400"
                  : "text-gray-400"
            }
          />
          <KpiCard
            label="Media/transacción"
            value={`${stats.data.avgTransactionEur.toFixed(2)}€`}
          />
        </div>
      )}

      {/* Revenue por tipo */}
      {stats.data && stats.data.byType.length > 0 && (
        <div className="mt-6 rounded-xl border border-gray-800 bg-gray-900 p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-white">Distribución por tipo</h2>
          <div className="mt-4 space-y-3">
            {stats.data.byType.map((t) => {
              const pct =
                stats.data!.totalRevenueEur > 0
                  ? (t.totalEur / stats.data!.totalRevenueEur) * 100
                  : 0;
              return (
                <div key={t.type}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">{typeLabels[t.type] ?? t.type}</span>
                    <span className="text-white">{t.totalEur.toFixed(2)}€ ({Math.round(pct)}%)</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-gray-800">
                    <div
                      className={cn("h-2 rounded-full", typeColors[t.type] ?? "bg-gray-500")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tendencia */}
      {trend.data && trend.data.length > 0 && (
        <div className="mt-6 rounded-xl border border-gray-800 bg-gray-900 p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Tendencia</h2>
            <div className="flex gap-1">
              {(["daily", "weekly", "monthly"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setTrendPeriod(p)}
                  className={cn(
                    "rounded px-2 py-1 text-xs",
                    trendPeriod === p
                      ? "bg-indigo-600 text-white"
                      : "text-gray-400 hover:text-white"
                  )}
                >
                  {p === "daily" ? "Día" : p === "weekly" ? "Semana" : "Mes"}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <TrendChart
              data={trend.data.map((d) => ({ date: d.date, value: d.totalEur }))}
              valueSuffix="€"
            />
          </div>
        </div>
      )}

      {/* Two columns: Top Spenders + ROI */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Top Spenders */}
        {topSpenders.data && topSpenders.data.length > 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 sm:p-6">
            <h2 className="text-sm font-semibold text-white">Top Spenders</h2>
            <div className="mt-4 space-y-2">
              {topSpenders.data.map((s, i) => (
                <div key={s.contactId} className="flex items-center justify-between rounded-lg bg-gray-800/50 px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-gray-500">#{i + 1}</span>
                    <div>
                      <p className="text-sm text-white">{s.displayName ?? s.username}</p>
                      <p className="text-xs text-gray-500">@{s.username} · {s.platformType}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-green-400">{s.totalRevenueEur.toFixed(2)}€</p>
                    <p className="text-xs text-gray-500">{s.transactionCount} tx</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ROI Ranking */}
        {roiRanking.data && roiRanking.data.length > 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 sm:p-6">
            <h2 className="text-sm font-semibold text-white">Mejor ROI (€/hora)</h2>
            <div className="mt-4 space-y-2">
              {roiRanking.data.map((r, i) => (
                <div key={r.contactId} className="flex items-center justify-between rounded-lg bg-gray-800/50 px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-gray-500">#{i + 1}</span>
                    <div>
                      <p className="text-sm text-white">{r.displayName ?? r.username}</p>
                      <p className="text-xs text-gray-500">{r.totalMessages} msgs · {r.totalRevenueEur.toFixed(2)}€</p>
                    </div>
                  </div>
                  <p className="text-sm font-semibold text-indigo-400">{r.revenuePerHour.toFixed(2)}€/h</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Empty state */}
      {stats.data && stats.data.transactionCount === 0 && (
        <div className="mt-12 text-center">
          <p className="text-lg text-gray-400">Sin transacciones aún</p>
          <p className="mt-1 text-sm text-gray-600">
            Registra transacciones desde el panel de contacto en las conversaciones
          </p>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  valueColor = "text-white",
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={cn("mt-1 text-xl font-bold", valueColor)}>{value}</p>
    </div>
  );
}

