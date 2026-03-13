import { useCallback } from "react";
import { useUpgradeModal } from "@/components/billing/upgrade-modal";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { AppRouter } from "@/server/api/root";

type TRPCError = TRPCClientErrorLike<AppRouter>;

export function useTrpcErrorHandler() {
  const { showUpgrade } = useUpgradeModal();

  const handleError = useCallback((error: unknown) => {
    const trpcError = error as TRPCError;

    // Si es error de límite excedido
    if (trpcError?.data?.code === "FORBIDDEN") {
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
