"use client";

import { trpc } from "@/lib/trpc";
import { PlanBadge } from "@/components/billing/plan-badge";
import { UsageCard } from "@/components/billing/usage-card";
import { PricingTable } from "@/components/landing/pricing-table";
import { Skeleton, UsageCardSkeleton } from "@/components/ui/skeleton";

export default function BillingPage() {
  const planQuery = trpc.billing.getPlan.useQuery();
  const usageQuery = trpc.billing.getUsage.useQuery();
  const invoicesQuery = trpc.billing.getInvoices.useQuery();
  const checkoutMutation = trpc.billing.createCheckoutSession.useMutation();
  const portalMutation = trpc.billing.createPortalSession.useMutation();

  async function handleUpgrade(plan: "starter" | "pro") {
    const result = await checkoutMutation.mutateAsync({ plan });
    if (result.url) {
      window.location.href = result.url;
    }
  }

  async function handleManageSubscription() {
    const result = await portalMutation.mutateAsync();
    if (result.url) {
      window.location.href = result.url;
    }
  }

  const plan = planQuery.data;
  const usage = usageQuery.data;
  const invoices = invoicesQuery.data;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-2xl font-bold text-white">Billing</h1>
        <p className="mt-1 text-sm text-gray-400">
          Gestiona tu plan y suscripcion.
        </p>

        {/* Current Plan */}
        <div className="mt-8 rounded-xl border border-gray-800 bg-gray-900 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Plan actual</h2>
              <div className="mt-2 flex items-center gap-3">
                {planQuery.isLoading ? (
                  <Skeleton className="h-6 w-20" />
                ) : plan ? (
                  <PlanBadge plan={plan.plan} />
                ) : null}
                {plan?.currentPeriodEnd && (
                  <span className="text-sm text-gray-400">
                    Renueva el{" "}
                    {new Date(plan.currentPeriodEnd).toLocaleDateString("es-ES")}
                  </span>
                )}
              </div>
            </div>
            {plan?.hasSubscription && (
              <button
                onClick={handleManageSubscription}
                disabled={portalMutation.isPending}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50"
              >
                {portalMutation.isPending
                  ? "Abriendo..."
                  : "Gestionar suscripcion"}
              </button>
            )}
          </div>
        </div>

        {/* Usage */}
        {usageQuery.isLoading ? (
          <div className="mt-8">
            <h2 className="mb-4 text-lg font-semibold text-white">
              Uso del mes
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <UsageCardSkeleton key={i} />
              ))}
            </div>
          </div>
        ) : usage ? (
          <div className="mt-8">
            <h2 className="mb-4 text-lg font-semibold text-white">
              Uso del mes
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <UsageCard
                label="Contactos"
                used={usage.usage.contacts.used}
                limit={usage.usage.contacts.limit}
                icon={
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                  </svg>
                }
              />
              <UsageCard
                label="Mensajes IA"
                used={usage.usage.aiMessages.used}
                limit={usage.usage.aiMessages.limit}
                icon={
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                  </svg>
                }
              />
              <UsageCard
                label="Plataformas"
                used={usage.usage.platforms.used}
                limit={usage.usage.platforms.limit}
                icon={
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
                  </svg>
                }
              />
              <UsageCard
                label="Templates"
                used={usage.usage.templates.used}
                limit={usage.usage.templates.limit}
                icon={
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
                  </svg>
                }
              />
              <UsageCard
                label="Reportes IA"
                used={usage.usage.reports.used}
                limit={usage.usage.reports.limit}
                icon={
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                }
              />
            </div>
          </div>
        ) : null}

        {/* Pricing */}
        <div className="mt-8">
          <h2 className="mb-4 text-lg font-semibold text-white">Planes</h2>
          <PricingTable
            currentPlan={plan?.plan}
            onSelectPlan={handleUpgrade}
          />
        </div>

        {/* Invoices */}
        {invoices && invoices.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-4 text-lg font-semibold text-white">
              Facturas recientes
            </h2>
            <div className="overflow-hidden rounded-xl border border-gray-800">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-400">
                      Fecha
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-400">
                      Monto
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-400">
                      Estado
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-400">
                      PDF
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="bg-gray-900/50">
                      <td className="px-4 py-3 text-sm text-gray-300">
                        {invoice.date
                          ? new Date(invoice.date).toLocaleDateString("es-ES")
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-white">
                        ${invoice.amount.toFixed(2)} {invoice.currency?.toUpperCase()}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
                          {invoice.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {invoice.pdfUrl && (
                          <a
                            href={invoice.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-indigo-400 hover:text-indigo-300"
                          >
                            Descargar
                          </a>
                        )}
                      </td>
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
