"use client";

import { trpc } from "@/lib/trpc";

export default function AdminAIUsagePage() {
  const query = trpc.admin.getAIUsageGlobal.useQuery();

  const data = query.data;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-2xl font-bold text-white">Uso de IA global</h1>
        <p className="mt-1 text-sm text-gray-400">Últimos 30 días en todos los creators.</p>

        {query.isLoading ? (
          <div className="mt-8 space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl bg-gray-800" />
            ))}
          </div>
        ) : data ? (
          <div className="mt-8 space-y-6">
            {/* Por modelo */}
            <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
              <div className="border-b border-gray-800 px-5 py-3">
                <h2 className="text-sm font-semibold text-gray-400">Por modelo</h2>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500">Modelo</th>
                    <th className="px-5 py-3 text-right text-xs font-medium uppercase text-gray-500">Requests</th>
                    <th className="px-5 py-3 text-right text-xs font-medium uppercase text-gray-500">Tokens</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {data.byProvider.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-5 py-8 text-center text-sm text-gray-500">
                        Sin datos.
                      </td>
                    </tr>
                  ) : (
                    data.byProvider.map((row) => (
                      <tr key={row.model} className="hover:bg-gray-800/40">
                        <td className="px-5 py-3 font-mono text-sm text-white">{row.model}</td>
                        <td className="px-5 py-3 text-right text-sm text-white">{row.requests.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right text-sm text-gray-400">
                          {(row.tokens / 1000).toFixed(1)}k
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Por tipo de request */}
            <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
              <div className="border-b border-gray-800 px-5 py-3">
                <h2 className="text-sm font-semibold text-gray-400">Por tipo de request</h2>
              </div>
              <div className="grid grid-cols-2 gap-px bg-gray-800 sm:grid-cols-4">
                {data.byType.map((row) => (
                  <div key={row.type} className="bg-gray-900 px-5 py-4">
                    <p className="text-xs font-medium capitalize text-gray-500">{row.type}</p>
                    <p className="mt-1 text-2xl font-bold text-white">{row.requests.toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Actividad diaria */}
            <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
              <div className="border-b border-gray-800 px-5 py-3">
                <h2 className="text-sm font-semibold text-gray-400">Actividad diaria (últimos 30 días)</h2>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="px-5 py-3 text-left text-xs font-medium uppercase text-gray-500">Día</th>
                    <th className="px-5 py-3 text-right text-xs font-medium uppercase text-gray-500">Requests</th>
                    <th className="px-5 py-3 text-right text-xs font-medium uppercase text-gray-500">Tokens</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {data.byDay.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-5 py-8 text-center text-sm text-gray-500">
                        Sin actividad.
                      </td>
                    </tr>
                  ) : (
                    [...data.byDay].reverse().map((row) => (
                      <tr key={row.day} className="hover:bg-gray-800/40">
                        <td className="px-5 py-2.5 text-sm text-white">
                          {new Date(row.day).toLocaleDateString("es-ES", {
                            weekday: "short", day: "numeric", month: "short",
                          })}
                        </td>
                        <td className="px-5 py-2.5 text-right text-sm text-white">
                          {row.requests.toLocaleString()}
                        </td>
                        <td className="px-5 py-2.5 text-right text-sm text-gray-400">
                          {(row.tokens / 1000).toFixed(1)}k
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
