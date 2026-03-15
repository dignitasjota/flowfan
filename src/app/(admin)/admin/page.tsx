"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-1.5 text-3xl font-bold ${accent ?? "text-white"}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

const PLAN_COLOR: Record<string, string> = {
  free: "bg-gray-700 text-gray-300",
  starter: "bg-blue-600/20 text-blue-400",
  pro: "bg-indigo-600/20 text-indigo-400",
  business: "bg-amber-600/20 text-amber-400",
};

export default function AdminDashboardPage() {
  const statsQuery = trpc.admin.getGlobalStats.useQuery();
  const topQuery = trpc.admin.getTopActiveCreators.useQuery({ metric: "ai_requests", limit: 5 });
  const churnQuery = trpc.admin.getChurnRisk.useQuery();

  const stats = statsQuery.data;
  const top = topQuery.data;
  const churn = churnQuery.data;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-white">Panel de administración</h1>
          <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white">
            Admin
          </span>
        </div>
        <p className="mt-1 text-sm text-gray-400">
          Vista global de todos los creators y métricas del sistema.
        </p>

        {/* KPIs */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statsQuery.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-800" />
            ))
          ) : stats ? (
            <>
              <KpiCard
                label="Creators totales"
                value={stats.totalCreators}
                sub={`+${stats.newThisMonth} este mes`}
              />
              <KpiCard
                label="MRR estimado"
                value={`$${stats.mrr.toLocaleString()}`}
                sub="Basado en planes activos"
                accent="text-green-400"
              />
              <KpiCard
                label="Requests IA (mes)"
                value={stats.aiUsageThisMonth.requests.toLocaleString()}
                sub={`${(stats.aiUsageThisMonth.tokens / 1000).toFixed(0)}k tokens`}
              />
              <KpiCard
                label="Contactos totales"
                value={stats.totalContacts.toLocaleString()}
                sub="En todos los creators"
              />
            </>
          ) : null}
        </div>

        {/* Plan distribution */}
        {stats && (
          <div className="mt-8 rounded-xl border border-gray-800 bg-gray-900 p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-400">
              Distribución de planes
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(["free", "starter", "pro", "business"] as const).map((plan) => {
                const n = stats.planDistribution[plan];
                const pct = stats.totalCreators > 0
                  ? Math.round((n / stats.totalCreators) * 100)
                  : 0;
                return (
                  <div key={plan} className="rounded-lg border border-gray-800 p-4 text-center">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${PLAN_COLOR[plan]}`}>
                      {plan}
                    </span>
                    <p className="mt-2 text-2xl font-bold text-white">{n}</p>
                    <p className="text-xs text-gray-500">{pct}%</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* Top creators */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                Top creators (IA este mes)
              </h2>
              <Link href="/admin/creators" className="text-xs text-indigo-400 hover:text-indigo-300">
                Ver todos →
              </Link>
            </div>
            {topQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-800" />
                ))}
              </div>
            ) : top && top.length > 0 ? (
              <div className="space-y-2">
                {top.map((c, i) => (
                  <Link
                    key={c.creatorId}
                    href={`/admin/creators/${c.creatorId}`}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-gray-800"
                  >
                    <span className="w-5 text-center text-sm font-bold text-gray-600">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{c.name}</p>
                      <p className="truncate text-xs text-gray-500">{c.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${PLAN_COLOR[c.plan]}`}>
                        {c.plan}
                      </span>
                      <span className="text-sm font-semibold text-white">{c.value}</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">Sin actividad este mes.</p>
            )}
          </div>

          {/* Churn risk */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                Riesgo de churn
              </h2>
              {churn && churn.pastDue.length > 0 && (
                <span className="rounded-full bg-yellow-600/20 px-2.5 py-0.5 text-xs font-semibold text-yellow-400">
                  {churn.pastDue.length} past_due
                </span>
              )}
            </div>
            {churnQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-800" />
                ))}
              </div>
            ) : churn && churn.pastDue.length > 0 ? (
              <div className="space-y-2">
                {churn.pastDue.slice(0, 6).map((c) => (
                  <Link
                    key={c.id}
                    href={`/admin/creators/${c.id}`}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-gray-800"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{c.name}</p>
                      <p className="truncate text-xs text-gray-500">{c.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${PLAN_COLOR[c.subscriptionPlan]}`}>
                        {c.subscriptionPlan}
                      </span>
                      <span className="rounded-full bg-yellow-600/20 px-2 py-0.5 text-xs font-medium text-yellow-400">
                        past_due
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">Sin cuentas en riesgo.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
