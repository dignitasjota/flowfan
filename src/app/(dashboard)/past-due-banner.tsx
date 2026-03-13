"use client";

import { trpc } from "@/lib/trpc";

export function PastDueBanner() {
  const portalMutation = trpc.billing.createPortalSession.useMutation();

  async function handleClick() {
    const result = await portalMutation.mutateAsync();
    if (result.url) {
      window.location.href = result.url;
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5">
      <p className="text-sm text-amber-400">
        Tu pago ha fallado. Actualiza tu metodo de pago para evitar la
        suspension del servicio.
      </p>
      <button
        onClick={handleClick}
        disabled={portalMutation.isPending}
        className="flex-shrink-0 rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
      >
        {portalMutation.isPending ? "Abriendo..." : "Actualizar pago"}
      </button>
    </div>
  );
}
