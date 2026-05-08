"use client";

import { cn } from "@/lib/utils";

type Tactic = {
  name: string;
  description: string;
  example: string;
  riskLevel: "low" | "medium" | "high";
};

type Props = {
  result: {
    situationRead: string;
    audienceRisk: "low" | "medium" | "high";
    suggestedTone: string;
    tactics: Tactic[];
    whatToAvoid: string[];
    suggestedNextMove: string;
  };
  onApplyExample: (example: string) => void;
  onClose: () => void;
};

const RISK_COLORS: Record<"low" | "medium" | "high", string> = {
  low: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  high: "bg-red-500/15 text-red-300 border-red-500/30",
};

const RISK_LABEL: Record<"low" | "medium" | "high", string> = {
  low: "Riesgo bajo",
  medium: "Riesgo medio",
  high: "Riesgo alto",
};

export function CoachingPublicModal({ result, onApplyExample, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              🧭 Coaching IA · hilo público
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Optimizado para reputación de marca, no para conversión privada.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-md border border-gray-800 bg-gray-950/40 p-3">
            <div className="text-gray-500">Riesgo de audiencia</div>
            <span
              className={cn(
                "mt-1 inline-block rounded-full border px-2 py-0.5 text-xs font-medium",
                RISK_COLORS[result.audienceRisk]
              )}
            >
              {RISK_LABEL[result.audienceRisk]}
            </span>
          </div>
          <div className="rounded-md border border-gray-800 bg-gray-950/40 p-3">
            <div className="text-gray-500">Tono recomendado</div>
            <div className="mt-1 text-sm text-white">{result.suggestedTone}</div>
          </div>
        </div>

        <section className="mb-4 rounded-md border border-gray-800 bg-gray-950/40 p-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Lectura de la situación
          </h3>
          <p className="text-sm text-gray-200">{result.situationRead}</p>
        </section>

        <section className="mb-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Tácticas ({result.tactics.length})
          </h3>
          <div className="space-y-2">
            {result.tactics.map((t, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-md border p-3 text-sm",
                  RISK_COLORS[t.riskLevel]
                )}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-semibold text-white">{t.name}</span>
                  <span className="text-[10px] uppercase tracking-wider opacity-80">
                    {RISK_LABEL[t.riskLevel]}
                  </span>
                </div>
                <p className="mb-2 text-xs text-gray-200">{t.description}</p>
                <div className="rounded-md bg-gray-950/60 p-2 text-xs text-gray-100">
                  <span className="text-gray-500">Ejemplo:</span> {t.example}
                </div>
                <button
                  onClick={() => onApplyExample(t.example)}
                  className="mt-2 rounded-md bg-emerald-600/30 px-2 py-1 text-[11px] font-medium text-emerald-200 hover:bg-emerald-600/50"
                >
                  ↓ Usar este ejemplo
                </button>
              </div>
            ))}
          </div>
        </section>

        {result.whatToAvoid.length > 0 && (
          <section className="mb-4 rounded-md border border-red-500/20 bg-red-500/5 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-300">
              ⚠️ Qué evitar
            </h3>
            <ul className="space-y-1 text-xs text-red-200">
              {result.whatToAvoid.map((w, i) => (
                <li key={i}>• {w}</li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-md border border-indigo-500/30 bg-indigo-500/10 p-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-indigo-300">
            👉 Movimiento recomendado
          </h3>
          <p className="text-sm text-indigo-100">{result.suggestedNextMove}</p>
        </section>
      </div>
    </div>
  );
}
