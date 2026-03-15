"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";

const PLAN_COLOR: Record<string, string> = {
  free: "bg-gray-700 text-gray-300",
  starter: "bg-blue-600/20 text-blue-400",
  pro: "bg-indigo-600/20 text-indigo-400",
  business: "bg-amber-600/20 text-amber-400",
};
const STATUS_COLOR: Record<string, string> = {
  active: "text-green-400",
  trialing: "text-blue-400",
  past_due: "text-yellow-400",
  canceled: "text-red-400",
};

type Tab = "perfil" | "suscripcion" | "ia" | "datos" | "auditoria";

export default function AdminCreatorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<Tab>("perfil");

  // Queries
  const creatorQuery = trpc.admin.getCreator.useQuery({ creatorId: id });
  const aiConfigQuery = trpc.admin.getCreatorAIConfig.useQuery({ creatorId: id });

  // Mutations
  const updatePlan = trpc.admin.updatePlan.useMutation({
    onSuccess: () => utils.admin.getCreator.invalidate({ creatorId: id }),
  });
  const updateStatus = trpc.admin.updateStatus.useMutation({
    onSuccess: () => utils.admin.getCreator.invalidate({ creatorId: id }),
  });
  const updateRole = trpc.admin.updateRole.useMutation({
    onSuccess: () => utils.admin.getCreator.invalidate({ creatorId: id }),
  });
  const extendTrial = trpc.admin.extendTrial.useMutation({
    onSuccess: () => utils.admin.getCreator.invalidate({ creatorId: id }),
  });
  const syncStripe = trpc.admin.syncStripeSubscription.useMutation({
    onSuccess: () => utils.admin.getCreator.invalidate({ creatorId: id }),
  });
  const resetOnboarding = trpc.admin.resetOnboarding.useMutation({
    onSuccess: () => utils.admin.getCreator.invalidate({ creatorId: id }),
  });
  const deleteCreator = trpc.admin.deleteCreator.useMutation({
    onSuccess: () => router.push("/admin/creators"),
  });

  // State para acciones
  const [planValue, setPlanValue] = useState("");
  const [statusValue, setStatusValue] = useState("");
  const [trialDays, setTrialDays] = useState(7);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [reason, setReason] = useState("");

  const c = creatorQuery.data;

  if (creatorQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (!c) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-gray-400">Creator no encontrado.</p>
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "perfil", label: "Perfil" },
    { key: "suscripcion", label: "Suscripción" },
    { key: "ia", label: "Config IA" },
    { key: "datos", label: "Estadísticas" },
    { key: "auditoria", label: "Auditoría" },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-indigo-600/20 text-xl font-bold text-indigo-400">
            {c.name[0]?.toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white">{c.name}</h1>
              {c.role === "admin" && (
                <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                  admin
                </span>
              )}
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${PLAN_COLOR[c.subscriptionPlan]}`}>
                {c.subscriptionPlan}
              </span>
            </div>
            <p className="text-sm text-gray-400">{c.email}</p>
            <p className="mt-0.5 text-xs text-gray-600">
              Registrado el {new Date(c.createdAt).toLocaleDateString("es-ES")}
              {" · "}
              Onboarding: {c.onboardingCompleted ? "completado" : "pendiente"}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-6 flex gap-1 border-b border-gray-800">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "border-b-2 border-indigo-500 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="mt-6">

          {/* ── PERFIL ─────────────────────────────── */}
          {tab === "perfil" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                <h3 className="mb-4 text-sm font-semibold text-gray-400">Información básica</h3>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["ID", c.id],
                    ["Email", c.email],
                    ["Nombre", c.name],
                    ["Rol", c.role],
                    ["Email verificado", c.emailVerified ? "Sí" : "No"],
                    ["Onboarding", c.onboardingCompleted ? "Completado" : "Pendiente"],
                    ["Stripe ID", c.stripeCustomerId ?? "—"],
                    ["Última actualización", new Date(c.updatedAt).toLocaleString("es-ES")],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs text-gray-500">{k}</dt>
                      <dd className="mt-0.5 truncate text-sm text-white">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* Cambiar rol */}
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                <h3 className="mb-3 text-sm font-semibold text-gray-400">Cambiar rol</h3>
                <div className="flex items-center gap-3">
                  <select
                    value={c.role}
                    onChange={(e) =>
                      updateRole.mutate({ creatorId: id, role: e.target.value as any })
                    }
                    disabled={updateRole.isPending}
                    className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none disabled:opacity-50"
                  >
                    <option value="creator">Creator</option>
                    <option value="admin">Admin</option>
                  </select>
                  {updateRole.isPending && (
                    <span className="text-xs text-gray-500">Guardando...</span>
                  )}
                  {updateRole.isSuccess && (
                    <span className="text-xs text-green-400">Guardado</span>
                  )}
                </div>
              </div>

              {/* Resetear onboarding */}
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                <h3 className="mb-1 text-sm font-semibold text-gray-400">Resetear onboarding</h3>
                <p className="mb-3 text-xs text-gray-500">
                  El creator verá el wizard de configuración inicial al próximo login.
                </p>
                <button
                  onClick={() => resetOnboarding.mutate({ creatorId: id })}
                  disabled={resetOnboarding.isPending || !c.onboardingCompleted}
                  className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-40"
                >
                  {resetOnboarding.isPending ? "Reseteando..." : "Resetear onboarding"}
                </button>
              </div>

              {/* Eliminar cuenta */}
              <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-5">
                <h3 className="mb-1 text-sm font-semibold text-red-400">Zona peligrosa</h3>
                <p className="mb-3 text-xs text-gray-500">
                  Elimina la cuenta permanentemente. Se cancelará la suscripción de Stripe y se borrarán todos sus datos.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    placeholder='Escribe "ELIMINAR" para confirmar'
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-red-500 focus:outline-none"
                  />
                  <button
                    onClick={() =>
                      deleteCreator.mutate({
                        creatorId: id,
                        confirmation: "ELIMINAR",
                        reason: "Borrado manual por admin",
                      })
                    }
                    disabled={deleteConfirm !== "ELIMINAR" || deleteCreator.isPending}
                    className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-40"
                  >
                    {deleteCreator.isPending ? "Eliminando..." : "Eliminar cuenta"}
                  </button>
                </div>
                {deleteCreator.error && (
                  <p className="mt-2 text-xs text-red-400">{deleteCreator.error.message}</p>
                )}
              </div>
            </div>
          )}

          {/* ── SUSCRIPCIÓN ────────────────────────── */}
          {tab === "suscripcion" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                <h3 className="mb-4 text-sm font-semibold text-gray-400">Estado actual</h3>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["Plan", c.subscriptionPlan],
                    ["Estado", c.subscriptionStatus],
                    ["Stripe Subscription", c.stripeSubscriptionId ?? "—"],
                    ["Stripe Price ID", c.stripePriceId ?? "—"],
                    [
                      "Fin de periodo",
                      c.currentPeriodEnd
                        ? new Date(c.currentPeriodEnd).toLocaleDateString("es-ES")
                        : "—",
                    ],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs text-gray-500">{k}</dt>
                      <dd className={`mt-0.5 text-sm font-medium ${
                        k === "Estado" ? STATUS_COLOR[v as string] ?? "text-white" : "text-white"
                      }`}>
                        {v}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* Cambiar plan */}
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                <h3 className="mb-3 text-sm font-semibold text-gray-400">Cambiar plan manualmente</h3>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={planValue || c.subscriptionPlan}
                    onChange={(e) => setPlanValue(e.target.value)}
                    className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                  >
                    {["free", "starter", "pro", "business"].map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  <input
                    placeholder="Motivo (opcional)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="flex-1 min-w-0 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    onClick={() =>
                      updatePlan.mutate({
                        creatorId: id,
                        plan: (planValue || c.subscriptionPlan) as any,
                        reason,
                      })
                    }
                    disabled={updatePlan.isPending}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {updatePlan.isPending ? "Guardando..." : "Aplicar"}
                  </button>
                </div>
                {updatePlan.isSuccess && (
                  <p className="mt-2 text-xs text-green-400">Plan actualizado correctamente.</p>
                )}
              </div>

              {/* Cambiar estado */}
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                <h3 className="mb-3 text-sm font-semibold text-gray-400">Cambiar estado</h3>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={statusValue || c.subscriptionStatus}
                    onChange={(e) => setStatusValue(e.target.value)}
                    className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                  >
                    {["active", "trialing", "past_due", "canceled"].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <button
                    onClick={() =>
                      updateStatus.mutate({
                        creatorId: id,
                        status: (statusValue || c.subscriptionStatus) as any,
                      })
                    }
                    disabled={updateStatus.isPending}
                    className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                  >
                    {updateStatus.isPending ? "Guardando..." : "Aplicar"}
                  </button>
                </div>
              </div>

              {/* Extender periodo */}
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                <h3 className="mb-1 text-sm font-semibold text-gray-400">Extender acceso gratuito</h3>
                <p className="mb-3 text-xs text-gray-500">
                  Extiende el periodo actual N días sin pasar por Stripe.
                </p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={trialDays}
                    onChange={(e) => setTrialDays(Number(e.target.value))}
                    className="w-20 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                  />
                  <span className="flex items-center text-sm text-gray-400">días</span>
                  <button
                    onClick={() => extendTrial.mutate({ creatorId: id, days: trialDays })}
                    disabled={extendTrial.isPending}
                    className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                  >
                    {extendTrial.isPending ? "Aplicando..." : "Extender"}
                  </button>
                </div>
                {extendTrial.isSuccess && extendTrial.data?.newPeriodEnd && (
                  <p className="mt-2 text-xs text-green-400">
                    Nuevo fin de periodo: {new Date(extendTrial.data.newPeriodEnd).toLocaleDateString("es-ES")}
                  </p>
                )}
              </div>

              {/* Sync Stripe */}
              {c.stripeSubscriptionId && (
                <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                  <h3 className="mb-1 text-sm font-semibold text-gray-400">
                    Sincronizar con Stripe
                  </h3>
                  <p className="mb-3 text-xs text-gray-500">
                    Re-lee la suscripción desde Stripe y actualiza el plan/estado.
                  </p>
                  <button
                    onClick={() => syncStripe.mutate({ creatorId: id })}
                    disabled={syncStripe.isPending}
                    className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                  >
                    {syncStripe.isPending ? "Sincronizando..." : "Sincronizar"}
                  </button>
                  {syncStripe.isSuccess && (
                    <p className="mt-2 text-xs text-green-400">
                      Stripe status: {syncStripe.data?.stripeStatus}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── CONFIG IA ──────────────────────────── */}
          {tab === "ia" && (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
              <h3 className="mb-4 text-sm font-semibold text-gray-400">Configuración IA actual</h3>
              {aiConfigQuery.isLoading ? (
                <div className="h-20 animate-pulse rounded-lg bg-gray-800" />
              ) : aiConfigQuery.data ? (
                <dl className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["Proveedor", aiConfigQuery.data.provider],
                    ["Modelo", aiConfigQuery.data.model],
                    ["API Key", aiConfigQuery.data.apiKey],
                    ["Activo", aiConfigQuery.data.isActive ? "Sí" : "No"],
                    ["Actualizado", new Date(aiConfigQuery.data.updatedAt).toLocaleString("es-ES")],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs text-gray-500">{k}</dt>
                      <dd className="mt-0.5 font-mono text-sm text-white">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-gray-500">
                  Este creator no tiene configuración IA.
                </p>
              )}
            </div>
          )}

          {/* ── ESTADÍSTICAS ───────────────────────── */}
          {tab === "datos" && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Contactos", c.stats.contacts],
                ["Conversaciones", c.stats.conversations],
                ["Requests IA (mes)", c.stats.aiMessagesThisMonth],
                ["Tokens IA (mes)", (c.stats.aiTokensThisMonth / 1000).toFixed(1) + "k"],
                ["Requests IA (total)", c.stats.aiMessagesTotal],
                ["Tokens IA (total)", (c.stats.aiTokensTotal / 1000).toFixed(1) + "k"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
                  <p className="mt-1.5 text-3xl font-bold text-white">{value}</p>
                </div>
              ))}
            </div>
          )}

          {/* ── AUDITORÍA ──────────────────────────── */}
          {tab === "auditoria" && (
            <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
              {c.auditHistory.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-gray-500">
                  Sin acciones de admin registradas.
                </p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Acción</th>
                      <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 sm:table-cell">Admin</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {c.auditHistory.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-800/40">
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-white">{log.action}</p>
                          {(log.previousValue != null || log.newValue != null) && (
                            <p className="mt-0.5 text-xs text-gray-500">
                              {log.previousValue != null && (
                                <span className="text-red-400">{JSON.stringify(log.previousValue)}</span>
                              )}
                              {log.previousValue != null && log.newValue != null && " → "}
                              {log.newValue != null && (
                                <span className="text-green-400">{JSON.stringify(log.newValue)}</span>
                              )}
                            </p>
                          )}
                        </td>
                        <td className="hidden px-4 py-3 text-xs text-gray-400 sm:table-cell">
                          {log.admin?.name ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {new Date(log.createdAt).toLocaleString("es-ES")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
