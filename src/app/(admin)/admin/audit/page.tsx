"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";

const ACTION_LABELS: Record<string, string> = {
  plan_changed: "Plan cambiado",
  status_changed: "Estado cambiado",
  role_changed: "Rol cambiado",
  onboarding_reset: "Onboarding reseteado",
  creator_deleted: "Cuenta eliminada",
  stripe_synced: "Stripe sincronizado",
  trial_extended: "Periodo extendido",
  ai_config_changed: "Config IA modificada",
};

const ACTION_COLOR: Record<string, string> = {
  plan_changed: "bg-indigo-600/20 text-indigo-400",
  status_changed: "bg-yellow-600/20 text-yellow-400",
  role_changed: "bg-red-600/20 text-red-400",
  onboarding_reset: "bg-gray-700 text-gray-300",
  creator_deleted: "bg-red-700/30 text-red-400",
  stripe_synced: "bg-blue-600/20 text-blue-400",
  trial_extended: "bg-green-600/20 text-green-400",
  ai_config_changed: "bg-purple-600/20 text-purple-400",
};

export default function AdminAuditPage() {
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const query = trpc.admin.getAuditLog.useQuery({ limit: LIMIT, offset });

  const logs = query.data?.logs ?? [];
  const total = query.data?.total ?? 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-2xl font-bold text-white">Audit Log</h1>
        <p className="mt-1 text-sm text-gray-400">
          Historial de todas las acciones de administración.
          {total > 0 && <span className="ml-1 text-gray-500">({total} registros)</span>}
        </p>

        <div className="mt-6 overflow-hidden rounded-xl border border-gray-800">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Acción</th>
                <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 sm:table-cell">
                  Afectado
                </th>
                <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 md:table-cell">
                  Admin
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {query.isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={4} className="px-4 py-3">
                      <div className="h-5 animate-pulse rounded bg-gray-800" />
                    </td>
                  </tr>
                ))
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-500">
                    Sin registros aún.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="bg-gray-900/40 hover:bg-gray-800/60">
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ACTION_COLOR[log.action] ?? "bg-gray-700 text-gray-300"}`}>
                        {ACTION_LABELS[log.action] ?? log.action}
                      </span>
                      {(log.previousValue != null || log.newValue != null) && (
                        <p className="mt-1 text-[11px] text-gray-600">
                          {log.previousValue != null && (
                            <span className="text-red-500">{JSON.stringify(log.previousValue)}</span>
                          )}
                          {log.previousValue != null && log.newValue != null && <span className="mx-1">→</span>}
                          {log.newValue != null && (
                            <span className="text-green-500">{JSON.stringify(log.newValue)}</span>
                          )}
                        </p>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      {log.targetCreator ? (
                        <div>
                          <p className="text-sm text-white">{log.targetCreator.name}</p>
                          <p className="text-xs text-gray-500">{log.targetCreator.email}</p>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-600">—</span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-xs text-gray-400 md:table-cell">
                      {log.admin?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(log.createdAt).toLocaleString("es-ES")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > LIMIT && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {offset + 1}–{Math.min(offset + LIMIT, total)} de {total}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                disabled={offset === 0}
                className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-800 disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                onClick={() => setOffset(offset + LIMIT)}
                disabled={offset + LIMIT >= total}
                className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-800 disabled:opacity-40"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
