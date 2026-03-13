"use client";

import { useEffect } from "react";
import { useUpgradeModal } from "@/components/billing/upgrade-modal";

/**
 * Global error handler para tRPC
 * Muestra el modal de upgrade cuando se alcanza un límite
 */
export function TrpcErrorProvider({ children }: { children: React.ReactNode }) {
  const { showUpgrade } = useUpgradeModal();

  useEffect(() => {
    // Escuchar errores no capturados de tRPC
    const handleError = (event: ErrorEvent) => {
      const message = event.message || "";

      // Si el mensaje contiene "FORBIDDEN" o menciona límites
      if (
        message.includes("FORBIDDEN") ||
        message.includes("límite") ||
        message.includes("agotado") ||
        message.includes("excedido")
      ) {
        event.preventDefault();
        showUpgrade(
          "Has alcanzado el límite de tu plan actual. Actualiza para continuar."
        );
      }
    };

    // Listener para errores no capturados
    window.addEventListener("error", handleError);

    return () => window.removeEventListener("error", handleError);
  }, [showUpgrade]);

  return <>{children}</>;
}
