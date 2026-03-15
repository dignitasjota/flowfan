"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";

const PLAN_COLOR: Record<string, string> = {
  free: "bg-gray-700 text-gray-300",
  starter: "bg-blue-600/20 text-blue-400",
  pro: "bg-indigo-600/20 text-indigo-400",
  business: "bg-amber-600/20 text-amber-400",
};

const STATUS_COLOR: Record<string, string> = {
  active: "bg-green-600/20 text-green-400",
  trialing: "bg-blue-600/20 text-blue-400",
  past_due: "bg-yellow-600/20 text-yellow-400",
  canceled: "bg-red-600/20 text-red-400",
};

export default function AdminCreatorsPage() {
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const LIMIT = 25;

  const query = trpc.admin.listCreators.useQuery({
    search: search || undefined,
    plan: (plan || undefined) as any,
    status: (status || undefined) as any,
    limit: LIMIT,
    offset,
    orderBy: "createdAt",
    order: "desc",
  });

  const creators = query.data?.creators ?? [];
  const total = query.data?.total ?? 0;
  const hasMore = query.data?.hasMore ?? false;

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setOffset(0);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Creators</h1>
            <p className="mt-1 text-sm text-gray-400">
              {total > 0 ? `${total} usuarios registrados` : "Cargando..."}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-6 flex flex-wrap gap-3">
          <input
            type="text"
            placeholder="Buscar por nombre o email..."
            value={search}
            onChange={handleSearch}
            className="w-64 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
          <select
            value={plan}
            onChange={(e) => { setPlan(e.target.value); setOffset(0); }}
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
          >
            <option value="">Todos los planes</option>
            <option value="free">Free</option>
            <option value="starter">Starter</option>
            <option value="pro">Pro</option>
            <option value="business">Business</option>
          </select>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setOffset(0); }}
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
          >
            <option value="">Todos los estados</option>
            <option value="active">Active</option>
            <option value="trialing">Trialing</option>
            <option value="past_due">Past due</option>
            <option value="canceled">Canceled</option>
          </select>
        </div>

        {/* Table */}
        <div className="mt-4 overflow-hidden rounded-xl border border-gray-800">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Creator
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Plan
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Estado
                </th>
                <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:table-cell">
                  Registro
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Acción
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {query.isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={5} className="px-4 py-3">
                      <div className="h-6 animate-pulse rounded bg-gray-800" />
                    </td>
                  </tr>
                ))
              ) : creators.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">
                    No se encontraron creators.
                  </td>
                </tr>
              ) : (
                creators.map((c) => (
                  <tr key={c.id} className="bg-gray-900/40 hover:bg-gray-800/60 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600/20 text-sm font-semibold text-indigo-400">
                          {c.name[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white">{c.name}</p>
                          <p className="truncate text-xs text-gray-500">{c.email}</p>
                        </div>
                        {c.role === "admin" && (
                          <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                            admin
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${PLAN_COLOR[c.subscriptionPlan]}`}>
                        {c.subscriptionPlan}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLOR[c.subscriptionStatus]}`}>
                        {c.subscriptionStatus}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 text-xs text-gray-500 sm:table-cell">
                      {new Date(c.createdAt).toLocaleDateString("es-ES")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/creators/${c.id}`}
                        className="text-xs text-indigo-400 hover:text-indigo-300"
                      >
                        Ver →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > LIMIT && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Mostrando {offset + 1}–{Math.min(offset + LIMIT, total)} de {total}
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
                disabled={!hasMore}
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
