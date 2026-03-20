"use client";

import { cn } from "@/lib/utils";

type PricingPlan = {
  name: string;
  price: string;
  priceDetail: string;
  description: string;
  features: { text: string; included: boolean; highlight?: boolean }[];
  cta: string;
  popular?: boolean;
  planId?: "starter" | "pro";
};

const plans: PricingPlan[] = [
  {
    name: "Free",
    price: "$0",
    priceDetail: "para siempre",
    description: "Para probar FlowFan",
    features: [
      { text: "5 contactos", included: true },
      { text: "20 mensajes IA/mes", included: true },
      { text: "1 plataforma", included: true },
      { text: "3 templates", included: true },
      { text: "Scoring automatico", included: true },
      { text: "Reportes IA", included: false },
      { text: "Price Advisor", included: false },
      { text: "Telegram Bot", included: false },
      { text: "Broadcasts", included: false },
      { text: "Mensajes programados", included: false },
      { text: "Equipo / Chatters", included: false },
      { text: "Revenue tracking", included: false },
      { text: "Media Vault", included: false },
      { text: "Automatizaciones", included: false },
      { text: "Segmentos", included: false },
    ],
    cta: "Empezar gratis",
  },
  {
    name: "Starter",
    price: "€14",
    priceDetail: "/mes",
    description: "Para creadores en crecimiento",
    features: [
      { text: "50 contactos", included: true },
      { text: "200 mensajes IA/mes", included: true },
      { text: "3 plataformas", included: true },
      { text: "20 templates", included: true },
      { text: "Scoring automatico", included: true },
      { text: "5 reportes IA/mes", included: true },
      { text: "Price Advisor", included: false },
      { text: "Telegram Bot", included: false },
      { text: "2 broadcasts/mes (25 dest.)", included: true },
      { text: "5 mensajes programados/mes", included: true },
      { text: "Equipo / Chatters", included: false },
      { text: "Revenue basico", included: true },
      { text: "50 archivos media (100MB)", included: true },
      { text: "3 automatizaciones", included: true },
      { text: "5 segmentos", included: true },
    ],
    cta: "Elegir Starter",
    planId: "starter",
  },
  {
    name: "Pro",
    price: "€29",
    priceDetail: "/mes",
    description: "Para creadores profesionales",
    features: [
      { text: "Contactos ilimitados", included: true, highlight: true },
      { text: "2,000 mensajes IA/mes", included: true },
      { text: "Plataformas ilimitadas", included: true, highlight: true },
      { text: "Templates ilimitados", included: true },
      { text: "Scoring automatico", included: true },
      { text: "Reportes ilimitados", included: true, highlight: true },
      { text: "Price Advisor", included: true, highlight: true },
      { text: "Telegram Bot + auto-reply", included: true, highlight: true },
      { text: "10 broadcasts/mes (500 dest.)", included: true },
      { text: "50 mensajes prog. + horario optimo", included: true, highlight: true },
      { text: "3 miembros de equipo", included: true, highlight: true },
      { text: "Revenue completo", included: true },
      { text: "500 archivos media (1GB)", included: true },
      { text: "15 automatizaciones", included: true },
      { text: "25 segmentos", included: true },
    ],
    cta: "Elegir Pro",
    popular: true,
    planId: "pro",
  },
  {
    name: "Business",
    price: "Custom",
    priceDetail: "contactanos",
    description: "Para agencias y equipos grandes",
    features: [
      { text: "Todo en Pro +", included: true, highlight: true },
      { text: "Mensajes IA ilimitados", included: true, highlight: true },
      { text: "Plataformas ilimitadas", included: true },
      { text: "Templates ilimitados", included: true },
      { text: "Scoring automatico", included: true },
      { text: "Reportes ilimitados", included: true },
      { text: "Price Advisor", included: true },
      { text: "Telegram Bot + auto-reply ilim.", included: true },
      { text: "Broadcasts ilimitados + programacion", included: true, highlight: true },
      { text: "Mensajes programados ilimitados", included: true },
      { text: "10 miembros de equipo", included: true, highlight: true },
      { text: "Revenue + export completo", included: true },
      { text: "Media ilimitada", included: true },
      { text: "Automatizaciones ilimitadas", included: true },
      { text: "Segmentos ilimitados + API access", included: true, highlight: true },
    ],
    cta: "Contactar",
  },
];

type Props = {
  currentPlan?: string;
  onSelectPlan?: (plan: "starter" | "pro") => void;
  isLanding?: boolean;
};

export function PricingTable({ currentPlan, onSelectPlan, isLanding }: Props) {
  return (
    <section id="pricing" className="px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        {isLanding && (
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Planes simples y transparentes
            </h2>
            <p className="mt-4 text-lg text-gray-400">
              Empieza gratis. Actualiza cuando lo necesites. Cancela cuando quieras.
            </p>
          </div>
        )}

        {/* Mobile: horizontal scroll hint */}
        <p className="mt-8 text-center text-xs text-gray-500 sm:hidden">
          Desliza para ver todos los planes
        </p>

        {/* Scrollable container on mobile, grid on desktop */}
        <div
          className={cn(
            "mt-4 sm:mt-16",
            "flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory sm:overflow-visible sm:pb-0",
            "sm:grid sm:grid-cols-2 lg:grid-cols-4"
          )}
        >
          {plans.map((plan) => {
            const isCurrent = currentPlan === plan.name.toLowerCase();
            return (
              <div
                key={plan.name}
                className={cn(
                  "relative flex flex-shrink-0 snap-center flex-col rounded-xl border p-5 transition-colors sm:p-6",
                  "w-[300px] sm:w-auto",
                  plan.popular
                    ? "border-indigo-500 bg-gray-900 shadow-lg shadow-indigo-500/10"
                    : "border-gray-800 bg-gray-900 hover:border-gray-700"
                )}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white">
                    Popular
                  </div>
                )}

                <h3 className="text-lg font-semibold text-white">
                  {plan.name}
                </h3>
                <p className="mt-1 text-sm text-gray-400">{plan.description}</p>

                <div className="mt-4">
                  <span className="text-3xl font-bold text-white">
                    {plan.price}
                  </span>
                  <span className="text-sm text-gray-400">
                    {" "}{plan.priceDetail}
                  </span>
                </div>

                <ul className="mt-6 flex-1 space-y-2">
                  {plan.features.map((feature) => (
                    <li
                      key={feature.text}
                      className={cn(
                        "flex items-start gap-2 text-[13px]",
                        feature.included
                          ? feature.highlight ? "text-white" : "text-gray-300"
                          : "text-gray-600"
                      )}
                    >
                      {feature.included ? (
                        <svg
                          className={cn(
                            "mt-0.5 h-4 w-4 flex-shrink-0",
                            feature.highlight ? "text-indigo-400" : "text-gray-500"
                          )}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg
                          className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-700"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                      {feature.text}
                    </li>
                  ))}
                </ul>

                <div className="mt-8">
                  {isCurrent ? (
                    <div className="w-full rounded-lg border border-gray-600 py-2.5 text-center text-sm font-medium text-gray-400">
                      Plan actual
                    </div>
                  ) : plan.planId && onSelectPlan ? (
                    <button
                      onClick={() => onSelectPlan(plan.planId!)}
                      className={cn(
                        "w-full rounded-lg py-2.5 text-sm font-semibold transition-colors",
                        plan.popular
                          ? "bg-indigo-600 text-white hover:bg-indigo-500"
                          : "bg-gray-800 text-white hover:bg-gray-700"
                      )}
                    >
                      {plan.cta}
                    </button>
                  ) : plan.name === "Business" ? (
                    <a
                      href="mailto:hello@flowfan.app"
                      className="block w-full rounded-lg bg-gray-800 py-2.5 text-center text-sm font-semibold text-white hover:bg-gray-700 transition-colors"
                    >
                      {plan.cta}
                    </a>
                  ) : (
                    <a
                      href="/register"
                      className={cn(
                        "block w-full rounded-lg py-2.5 text-center text-sm font-semibold transition-colors",
                        plan.popular
                          ? "bg-indigo-600 text-white hover:bg-indigo-500"
                          : "bg-gray-800 text-white hover:bg-gray-700"
                      )}
                    >
                      {plan.cta}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Comparison note */}
        {isLanding && (
          <p className="mt-8 text-center text-xs text-gray-600">
            Todos los planes incluyen: cifrado AES-256, multi-tenant aislado, acceso web responsive y soporte por email.
          </p>
        )}
      </div>
    </section>
  );
}
