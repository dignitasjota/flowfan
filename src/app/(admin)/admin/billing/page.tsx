"use client";

import { trpc } from "@/lib/trpc";

const PLAN_COLOR: Record<string, string> = {
  free: "bg-gray-700 text-gray-300",
  starter: "bg-blue-600/20 text-blue-400",
  pro: "bg-indigo-600/20 text-indigo-400",
  business: "bg-amber-600/20 text-amber-400",
};

const PLAN_PRICES = { free: 0, starter: 15, pro: 29, business: 0 };

export default function AdminBillingPage() {
  const statsQuery = trpc.admin.getGlobalStats.useQuery();
  const topQuery = trpc.admin.getTopActiveCreators.useQuery({
    metric: "ai_requests",
    limit: 10,
  });

  const stats = statsQuery.data;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-2xl font-bold text-white">Billing global</h1>
        <p className="mt-1 text-sm text-gray-400">
          Resumen de ingresos y distribución de planes.
        </p>

        {/* MRR breakdown */}
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {statsQuery.isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-800" />
            ))
          ) : stats ? (
            <>
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-gray-500">MRR estimado</p>
                <p className="mt-1.5 text-3xl font-bold text-green-400">
                  ${stats.mrr.toLocaleString()}
                </p>
                <p className="mt-1 text-xs text-gray-500">Basado en planes activos</p>
              </div>
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-gray-500">ARR estimado</p>
                <p className="mt-1.5 text-3xl font-bold text-white">
                  ${(stats.mrr * 12).toLocaleString()}
                </p>
                <p className="mt-1 text-xs text-gray-500">MRR × 12</p>
              </div>
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Usuarios de pago</p>
                <p className="mt-1.5 text-3xl font-bold text-white">
                  {(stats.planDistribution.starter ?? 0) +
                    (stats.planDistribution.pro ?? 0) +
                    (stats.planDistribution.business ?? 0)}
                </p>
                <p className="mt-1 text-xs text-gray-500">Starter + Pro + Business</p>
              </div>
            </>
          ) : null}
        </div>

        {/* Plan breakdown table */}
        {stats && (
          <div className="mt-8 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900">
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Plan</th>
                  <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Usuarios</th>
                  <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Precio/mes</th>
                  <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">MRR</th>
                  <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">% total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800 bg-gray-900/40">
                {(["free", "starter", "pro", "business"] as const).map((plan) => {
                  const n = stats.planDistribution[plan] ?? 0;
                  const price = PLAN_PRICES[plan];
                  const planMrr = n * price;
                  const pct = stats.totalCreators > 0
                    ? ((n / stats.totalCreators) * 100).toFixed(1)
                    : "0";
                  return (
                    <tr key={plan}>
                      <td className="px-5 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${PLAN_COLOR[plan]}`}>
                          {plan}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-sm text-white">{n}</td>
                      <td className="px-5 py-3 text-right text-sm text-gray-400">
                        {price === 0 ? (plan === "business" ? "Custom" : "Gratis") : `$${price}`}
                      </td>
                      <td className="px-5 py-3 text-right text-sm font-semibold text-white">
                        {planMrr > 0 ? `$${planMrr.toLocaleString()}` : "—"}
                      </td>
                      <td className="px-5 py-3 text-right text-sm text-gray-400">{pct}%</td>
                    </tr>
                  );
                })}
                <tr className="border-t border-gray-700 bg-gray-900">
                  <td className="px-5 py-3 text-sm font-semibold text-white">Total</td>
                  <td className="px-5 py-3 text-right text-sm font-semibold text-white">{stats.totalCreators}</td>
                  <td className="px-5 py-3" />
                  <td className="px-5 py-3 text-right text-sm font-bold text-green-400">${stats.mrr.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right text-sm text-gray-400">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Top por uso IA */}
        {topQuery.data && topQuery.data.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-400">
              Top 10 por requests IA (este mes)
            </h2>
            <div className="overflow-hidden rounded-xl border border-gray-800">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">#</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Creator</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Plan</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Requests</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800 bg-gray-900/40">
                  {topQuery.data.map((c, i) => (
                    <tr key={c.creatorId}>
                      <td className="px-4 py-2.5 text-sm font-bold text-gray-600">{i + 1}</td>
                      <td className="px-4 py-2.5">
                        <p className="text-sm font-medium text-white">{c.name}</p>
                        <p className="text-xs text-gray-500">{c.email}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${PLAN_COLOR[c.plan]}`}>
                          {c.plan}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-sm font-semibold text-white">{c.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
