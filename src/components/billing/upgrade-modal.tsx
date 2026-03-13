"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

type UpgradeModalContextType = {
  showUpgrade: (message: string) => void;
  hideUpgrade: () => void;
};

const UpgradeModalContext = createContext<UpgradeModalContextType>({
  showUpgrade: () => {},
  hideUpgrade: () => {},
});

export function useUpgradeModal() {
  return useContext(UpgradeModalContext);
}

export function UpgradeModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");

  const showUpgrade = useCallback((msg: string) => {
    setMessage(msg || "Has alcanzado el límite de tu plan. Actualiza para continuar.");
    setIsOpen(true);
  }, []);

  const hideUpgrade = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <UpgradeModalContext.Provider value={{ showUpgrade, hideUpgrade }}>
      {children}

      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md animate-in zoom-in-95 rounded-xl border border-amber-500/50 bg-gray-900 p-6 shadow-2xl">
            {/* Icono de límite */}
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/20">
              <svg
                className="h-6 w-6 text-amber-400"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
              </svg>
            </div>

            {/* Contenido */}
            <h3 className="text-lg font-semibold text-white">
              Límite de plan alcanzado
            </h3>
            <p className="mt-2 text-sm text-gray-300">{message}</p>

            {/* Sugerencia */}
            <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <p className="text-xs text-amber-200">
                💡 <strong>Tip:</strong> Actualiza a un plan superior para
                acceder a más funcionalidades.
              </p>
            </div>

            {/* Botones */}
            <div className="mt-6 flex gap-3">
              <button
                onClick={hideUpgrade}
                className="flex-1 rounded-lg border border-gray-600 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:border-gray-500 hover:bg-gray-800 hover:text-white"
              >
                Cerrar
              </button>
              <a
                href="/billing"
                onClick={hideUpgrade}
                className="flex-1 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 py-2.5 text-center text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105 hover:from-indigo-500 hover:to-indigo-400"
              >
                Ver planes
              </a>
            </div>
          </div>
        </div>
      )}
    </UpgradeModalContext.Provider>
  );
}
