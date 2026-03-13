"use client";

import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

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

export default function DashboardPage() {
  const { data: stats, isLoading } = trpc.intelligence.getDashboardStats.useQuery();
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
      <div className="border-b border-gray-800 px-6 py-4">
        <h2 className="text-lg font-semibold text-white">Dashboard</h2>
      </div>

      <div className="space-y-6 p-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="Contactos" value={String(stats.totalContacts)} />
          <KpiCard label="Analizados" value={String(stats.analyzedContacts)} />
          <KpiCard
            label="Engagement promedio"
            value={`${stats.avgEngagement}/100`}
          />
          <KpiCard
            label="Prob. pago promedio"
            value={`${stats.avgPaymentProbability}%`}
          />
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
                    <span className="text-sm font-bold text-gray-500">
                      #{i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-white">
                        @{c.username}
                      </p>
                      <p className="text-xs text-gray-400">{c.platformType}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-white">
                      {c.paymentProbability}%
                    </p>
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

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
    </div>
  );
}
