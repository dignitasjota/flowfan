"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const STORAGE_KEY = "fanflow:welcome-dismissed";

const NEXT_STEPS = [
  {
    title: "Configura una personalidad",
    description: "Empieza por un preset y ajústalo en Settings → Personalidad.",
    href: "/settings",
    icon: "✨",
  },
  {
    title: "Programa tu primer post",
    description: "Conecta una cuenta Reddit o usa webhook para X / Instagram.",
    href: "/scheduler",
    icon: "📅",
  },
  {
    title: "Importa tus contactos",
    description: "Sube un CSV o crea contactos manualmente para empezar a operar.",
    href: "/contacts",
    icon: "👥",
  },
  {
    title: "Genera posts desde un blog",
    description: "Pega una URL y deja que la IA adapte el contenido por plataforma.",
    href: "/blog-to-social",
    icon: "📝",
  },
];

/**
 * Dismissible card that surfaces the obvious next steps right after onboarding.
 * Persists the dismissal in localStorage so it never reappears for that browser.
 */
export function WelcomeBanner() {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      setDismissed(true);
      return;
    }
    setDismissed(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  function dismiss() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "1");
    }
    setDismissed(true);
  }

  if (dismissed !== false) return null;

  return (
    <div className="border-b border-gray-800 bg-gradient-to-br from-indigo-950/40 via-gray-950/0 to-purple-950/30 px-6 py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
            <span>🎉</span> Bienvenido a FlowFan
          </div>
          <p className="text-xs text-gray-400">
            Tu cuenta está lista. Aquí tienes los siguientes pasos sugeridos.
          </p>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {NEXT_STEPS.map((step) => (
              <Link
                key={step.href}
                href={step.href}
                className="group flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-900/50 p-3 transition hover:border-indigo-500/40 hover:bg-gray-900/80"
              >
                <span className="text-xl">{step.icon}</span>
                <div className="flex-1">
                  <div className="text-xs font-semibold text-white group-hover:text-indigo-300">
                    {step.title}
                  </div>
                  <div className="mt-0.5 text-[11px] text-gray-500">
                    {step.description}
                  </div>
                </div>
                <span className="self-center text-gray-600 group-hover:text-indigo-400">
                  →
                </span>
              </Link>
            ))}
          </div>
        </div>

        <button
          onClick={dismiss}
          className="rounded-md p-1 text-gray-500 hover:bg-gray-800 hover:text-white"
          title="Cerrar"
          aria-label="Cerrar bienvenida"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
