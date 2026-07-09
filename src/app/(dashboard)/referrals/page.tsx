"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";

function euros(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  paid: "Pagada",
};

export default function ReferralsPage() {
  const codeQuery = trpc.referrals.getMyCode.useQuery();
  const statsQuery = trpc.referrals.getStats.useQuery();
  const rewardsQuery = trpc.referrals.listRewards.useQuery();
  const [copied, setCopied] = useState(false);

  const link = codeQuery.data?.link ?? "";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  const stats = statsQuery.data;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="text-2xl font-bold text-white">Programa de referidos</h1>
        <p className="mt-1 text-sm text-gray-400">
          Invita a otros creadores y gana una comisión cuando se suscriben a un
          plan de pago.
        </p>

        {/* Link de referido */}
        <div className="mt-8 rounded-xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="text-sm font-medium text-gray-300">Tu enlace de invitación</h2>
          <div className="mt-3 flex gap-2">
            <input
              readOnly
              value={link}
              className="flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200"
            />
            <button
              onClick={copyLink}
              disabled={!link}
              className="flex-shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {copied ? "¡Copiado!" : "Copiar"}
            </button>
          </div>
          {codeQuery.data?.code && (
            <p className="mt-2 text-xs text-gray-500">
              Código: <span className="font-mono text-gray-300">{codeQuery.data.code}</span>
            </p>
          )}
        </div>

        {/* Stats */}
        <div className="mt-6 grid gap-4 sm:grid-cols-4">
          <StatCard label="Invitados" value={stats ? String(stats.invited) : "—"} />
          <StatCard label="Convertidos" value={stats ? String(stats.converted) : "—"} />
          <StatCard
            label="Pendiente"
            value={stats ? euros(stats.pendingCents) : "—"}
          />
          <StatCard
            label="Total ganado"
            value={stats ? euros(stats.totalCents) : "—"}
            highlight
          />
        </div>

        {/* Rewards */}
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold text-white">Comisiones</h2>
          {rewardsQuery.data && rewardsQuery.data.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-gray-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-900 text-xs uppercase text-gray-500">
                    <th className="px-4 py-3 text-left">Referido</th>
                    <th className="px-4 py-3 text-left">Plan</th>
                    <th className="px-4 py-3 text-right">Comisión</th>
                    <th className="px-4 py-3 text-left">Estado</th>
                    <th className="px-4 py-3 text-right">Fecha</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {rewardsQuery.data.map((r) => (
                    <tr key={r.id} className="bg-gray-900/50">
                      <td className="px-4 py-3 text-gray-200">
                        {r.referredName ?? "—"}
                      </td>
                      <td className="px-4 py-3 capitalize text-gray-300">{r.plan}</td>
                      <td className="px-4 py-3 text-right text-white">
                        {euros(r.rewardCents)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            r.status === "paid"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-amber-500/10 text-amber-400"
                          }`}
                        >
                          {STATUS_LABEL[r.status] ?? r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400">
                        {r.createdAt
                          ? new Date(r.createdAt).toLocaleDateString("es-ES")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-800 py-10 text-center text-sm text-gray-500">
              Aún no tienes comisiones. Comparte tu enlace para empezar.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        highlight
          ? "border-indigo-500/40 bg-indigo-500/5"
          : "border-gray-800 bg-gray-900"
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
    </div>
  );
}
