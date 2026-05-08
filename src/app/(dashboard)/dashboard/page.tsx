"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { TrendChart } from "@/components/ui/trend-chart";
import { ChurnPanel } from "@/components/dashboard/churn-panel";
import { WelcomeBanner } from "@/components/dashboard/welcome-banner";

const funnelLabels: Record<string, string> = {
  cold: "Frio",
  curious: "Curioso",
  interested: "Interesado",
  hot_lead: "Comprador potencial",
  buyer: "Comprador",
  vip: "VIP",
};

const funnelColors: Record<string, string> = {
  cold: "bg-gray-500",
  curious: "bg-blue-500",
  interested: "bg-yellow-500",
  hot_lead: "bg-orange-500",
  buyer: "bg-green-500",
  vip: "bg-purple-500",
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

const platformColors: Record<string, string> = {
  instagram: "bg-pink-500",
  tinder: "bg-red-500",
  reddit: "bg-orange-500",
  onlyfans: "bg-blue-400",
  twitter: "bg-sky-500",
  telegram: "bg-blue-500",
  snapchat: "bg-yellow-400",
  other: "bg-gray-500",
};

type Period = "30d" | "60d" | "90d";

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>("30d");

  const { data: stats, isLoading } = trpc.intelligence.getDashboardStats.useQuery();
  const { data: enhanced } = trpc.intelligence.getEnhancedDashboardStats.useQuery({ period });
  const { data: notifs } = trpc.intelligence.getNotifications.useQuery({ limit: 20 });
  const { data: actions } = trpc.intelligence.getProactiveActions.useQuery();
  const markRead = trpc.intelligence.markNotificationRead.useMutation();
  const markAllRead = trpc.intelligence.markAllNotificationsRead.useMutation();
  const utils = trpc.useUtils();

  function handleMarkRead(id: string) {
    markRead.mutate(
      { notificationId: id },
      {
        onSuccess: () => {
          utils.intelligence.getNotifications.invalidate();
          utils.intelligence.getUnreadCount.invalidate();
          utils.intelligence.getDashboardStats.invalidate();
        },
      }
    );
  }

  function handleMarkAllRead() {
    markAllRead.mutate(undefined, {
      onSuccess: () => {
        utils.intelligence.getNotifications.invalidate();
        utils.intelligence.getUnreadCount.invalidate();
        utils.intelligence.getDashboardStats.invalidate();
      },
    });
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-gray-500">Cargando dashboard...</p>
      </div>
    );
  }

  if (!stats) return null;

  const maxFunnel = Math.max(...Object.values(stats.funnelDistribution), 1);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <WelcomeBanner />
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Dashboard</h2>
          <div className="flex gap-1">
            {(["30d", "60d", "90d"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "rounded px-2 py-1 text-xs",
                  period === p ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"
                )}
              >
                {p === "30d" ? "30 dias" : p === "60d" ? "60 dias" : "90 dias"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-6 p-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="Contactos" value={String(stats.totalContacts)} />
          <KpiCard
            label="Revenue (periodo)"
            value={`${(enhanced?.currentRevenueEur ?? 0).toFixed(2)}€`}
            change={enhanced?.revenueChangePercent}
          />
          <KpiCard
            label="Engagement promedio"
            value={`${stats.avgEngagement}/100`}
          />
          <KpiCard
            label="Churn rate"
            value={enhanced ? `${enhanced.churnRate}%` : "-"}
            subtitle={enhanced ? `${enhanced.inactiveCount} inactivos` : undefined}
            valueColor={
              enhanced && enhanced.churnRate > 20
                ? "text-red-400"
                : enhanced && enhanced.churnRate > 10
                  ? "text-yellow-400"
                  : "text-white"
            }
          />
        </div>

        {/* Revenue Trend */}
        {enhanced && enhanced.revenueTrend.length > 0 && (
          <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium uppercase tracking-wider text-gray-400">
                Tendencia de Revenue
              </h3>
              {enhanced.revenueChangePercent !== 0 && (
                <span
                  className={cn(
                    "text-xs font-medium",
                    enhanced.revenueChangePercent > 0 ? "text-green-400" : "text-red-400"
                  )}
                >
                  {enhanced.revenueChangePercent > 0 ? "+" : ""}
                  {enhanced.revenueChangePercent}% vs periodo anterior
                </span>
              )}
            </div>
            <div className="mt-4">
              <TrendChart
                data={enhanced.revenueTrend.map((d) => ({ date: d.date, value: d.totalEur }))}
                valueSuffix="€"
              />
            </div>
          </div>
        )}

        {/* Funnel Conversion + Response Time */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Funnel Conversion */}
          <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4 lg:col-span-2">
            <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">
              Conversion del funnel
            </h3>
            {enhanced && (
              <div className="space-y-3">
                {enhanced.funnelConversion.map((fc) => (
                  <div key={`${fc.from}-${fc.to}`} className="flex items-center gap-3">
                    <span className="w-28 text-xs text-gray-300">
                      {funnelLabels[fc.from]} → {funnelLabels[fc.to]}
                    </span>
                    <div className="flex-1">
                      <div className="h-5 rounded bg-gray-800">
                        <div
                          className="flex h-5 items-center rounded bg-indigo-600 pl-2 text-xs font-medium text-white transition-all"
                          style={{ width: `${Math.max(fc.rate, fc.rate > 0 ? 8 : 0)}%` }}
                        >
                          {fc.rate > 0 ? `${fc.rate}%` : ""}
                        </div>
                      </div>
                    </div>
                    <span className="w-10 text-right text-xs text-gray-400">{fc.rate}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Response Time + Stats */}
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                Tiempo medio de respuesta
              </p>
              <p className="mt-2 text-2xl font-bold text-white">
                {enhanced?.avgResponseMinutes != null
                  ? enhanced.avgResponseMinutes < 60
                    ? `${enhanced.avgResponseMinutes} min`
                    : `${(enhanced.avgResponseMinutes / 60).toFixed(1)} h`
                  : "Sin datos"}
              </p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                Prob. pago promedio
              </p>
              <p className="mt-2 text-2xl font-bold text-white">{stats.avgPaymentProbability}%</p>
            </div>
          </div>
        </div>

        {/* Platform ROI + At Risk Contacts */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Platform ROI */}
          {enhanced && enhanced.platformROI.length > 0 && (
            <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
              <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">
                Revenue por plataforma
              </h3>
              <div className="space-y-3">
                {enhanced.platformROI
                  .sort((a, b) => b.totalEur - a.totalEur)
                  .map((p) => {
                    const maxPlatformRevenue = Math.max(
                      ...enhanced.platformROI.map((pr) => pr.totalEur),
                      1
                    );
                    const pct = (p.totalEur / maxPlatformRevenue) * 100;
                    return (
                      <div key={p.platform}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-300">
                            {platformLabels[p.platform] ?? p.platform}
                          </span>
                          <span className="text-white">
                            {p.totalEur.toFixed(2)}€ · {p.contactCount} contactos
                          </span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-gray-800">
                          <div
                            className={cn(
                              "h-2 rounded-full",
                              platformColors[p.platform] ?? "bg-gray-500"
                            )}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* At Risk Contacts */}
          {enhanced && enhanced.atRiskContacts.length > 0 && (
            <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
              <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">
                Contactos en riesgo
              </h3>
              <div className="space-y-2">
                {enhanced.atRiskContacts.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded-lg bg-gray-800/50 px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">@{c.username}</p>
                      <p className="text-xs text-gray-500">
                        {platformLabels[c.platformType]} · {funnelLabels[c.funnelStage]}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-red-400">
                        {c.daysSinceInteraction}d sin interaccion
                      </p>
                      <p className="text-xs text-gray-500">
                        Engagement: {c.engagementLevel}/100
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Funnel Distribution */}
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
          <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">
            Distribucion del funnel
          </h3>
          <div className="space-y-3">
            {Object.entries(stats.funnelDistribution).map(([stage, count]) => (
              <div key={stage} className="flex items-center gap-3">
                <span className="w-36 text-sm text-gray-300">
                  {funnelLabels[stage] ?? stage}
                </span>
                <div className="flex-1">
                  <div className="h-6 rounded bg-gray-800">
                    <div
                      className={cn(
                        "flex h-6 items-center rounded pl-2 text-xs font-medium text-white transition-all",
                        funnelColors[stage] ?? "bg-gray-600"
                      )}
                      style={{
                        width: `${Math.max((count / maxFunnel) * 100, count > 0 ? 8 : 0)}%`,
                      }}
                    >
                      {count > 0 ? count : ""}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Contacts */}
        {stats.topByPayment.length > 0 && (
          <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">
              Top contactos por probabilidad de pago
            </h3>
            <div className="space-y-2">
              {stats.topByPayment.map((c, i) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-lg bg-gray-800/50 px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-gray-500">#{i + 1}</span>
                    <div>
                      <p className="text-sm font-medium text-white">@{c.username}</p>
                      <p className="text-xs text-gray-400">{c.platformType}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-white">{c.paymentProbability}%</p>
                    <p
                      className={cn(
                        "text-xs",
                        c.funnelStage === "vip"
                          ? "text-purple-400"
                          : c.funnelStage === "buyer"
                            ? "text-green-400"
                            : c.funnelStage === "hot_lead"
                              ? "text-orange-400"
                              : "text-gray-400"
                      )}
                    >
                      {funnelLabels[c.funnelStage] ?? c.funnelStage}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Churn Panel */}
        <ChurnPanel />

        {/* Proactive Actions */}
        {actions && actions.length > 0 && (
          <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">
              Acciones sugeridas
            </h3>
            <div className="space-y-2">
              {actions.slice(0, 10).map((action, i) => {
                const priorityColors = {
                  high: "border-l-red-500 bg-red-500/5",
                  medium: "border-l-yellow-500 bg-yellow-500/5",
                  low: "border-l-gray-500 bg-gray-500/5",
                };
                const typeIcons = {
                  engage: "💬",
                  offer: "💰",
                  price: "🏷️",
                  retain: "🔄",
                  followup: "📩",
                };
                return (
                  <div
                    key={i}
                    className={cn(
                      "rounded-lg border-l-2 px-3 py-2",
                      priorityColors[action.priority]
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-sm">{typeIcons[action.type] ?? "📋"}</span>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-white">{action.title}</p>
                        <p className="text-xs text-gray-400">{action.description}</p>
                        <p className="mt-1 text-[10px] text-gray-500">
                          @{action.contactUsername} · {action.platformType}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Notifications */}
        <div id="notifications" className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-medium uppercase tracking-wider text-gray-400">
              Notificaciones
            </h3>
            {notifs && notifs.some((n) => !n.isRead) && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-indigo-400 hover:text-indigo-300"
              >
                Marcar todas como leidas
              </button>
            )}
          </div>
          {!notifs || notifs.length === 0 ? (
            <p className="text-sm text-gray-500">No hay notificaciones aun</p>
          ) : (
            <div className="space-y-2">
              {notifs.map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    "rounded-lg px-3 py-2 transition-colors",
                    n.isRead ? "bg-gray-800/30" : "bg-gray-800/70 border-l-2 border-indigo-500"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-white">{n.title}</p>
                      <p className="text-xs text-gray-400">{n.message}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {new Date(n.createdAt).toLocaleString("es-ES", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                    {!n.isRead && (
                      <button
                        onClick={() => handleMarkRead(n.id)}
                        className="shrink-0 text-xs text-gray-500 hover:text-gray-300"
                      >
                        Leida
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  change,
  subtitle,
  valueColor = "text-white",
}: {
  label: string;
  value: string;
  change?: number;
  subtitle?: string;
  valueColor?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-400">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold", valueColor)}>{value}</p>
      {change != null && change !== 0 && (
        <p
          className={cn(
            "mt-0.5 text-xs font-medium",
            change > 0 ? "text-green-400" : "text-red-400"
          )}
        >
          {change > 0 ? "+" : ""}
          {change}% vs anterior
        </p>
      )}
      {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
    </div>
  );
}
