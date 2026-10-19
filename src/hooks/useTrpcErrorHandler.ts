import { useCallback } from "react";
import { useUpgradeModal } from "@/components/billing/upgrade-modal";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { AppRouter } from "@/server/api/root";

type TRPCError = TRPCClientErrorLike<AppRouter>;

/** Mensajes de usage-limits.ts: todos mencionan el plan o invitan a actualizarlo. */
export function isPlanLimitMessage(message: string | undefined): boolean {
  return !!message && /\bplan\b|actualiza/i.test(message);
}

export function useTrpcErrorHandler() {
  const { showUpgrade } = useUpgradeModal();

  const handleError = useCallback((error: unknown) => {
    const trpcError = error as TRPCError;

    // Solo los FORBIDDEN de límite/plan abren el modal de upgrade. Los de
    // permisos ("No tienes acceso…") no se arreglan pagando un plan mayor.
    if (trpcError?.data?.code === "FORBIDDEN" && isPlanLimitMessage(trpcError.message)) {
      showUpgrade(trpcError.message);
      return true; // Error fue manejado
    }

    // Si es otro error conocido de autenticación
    if (trpcError?.data?.code === "UNAUTHORIZED") {
      // Redirigir a login automáticamente
      window.location.href = "/login";
      return true;
    }

    return false; // Error no fue manejado aquí
  }, [showUpgrade]);

  return { handleError };
}
