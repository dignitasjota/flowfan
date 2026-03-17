"use client";

import { cn } from "@/lib/utils";

type PricingPlan = {
  name: string;
  price: string;
  priceDetail: string;
  description: string;
  features: string[];
  cta: string;
  popular?: boolean;
  planId?: "starter" | "pro";
};

const plans: PricingPlan[] = [
  {
    name: "Free",
    price: "$0",
    priceDetail: "para siempre",
    description: "Para probar FanFlow",
    features: [
      "5 contactos",
      "20 mensajes IA/mes",
      "1 plataforma",
      "3 templates",
    ],
    cta: "Empezar gratis",
  },
  {
    name: "Starter",
    price: "€14",
    priceDetail: "/mes",
    description: "Para creadores en crecimiento",
    features: [
      "50 contactos",
      "200 mensajes IA/mes",
      "3 plataformas",
      "20 templates",
      "5 reportes IA/mes",
      "Export CSV",
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
      "Contactos ilimitados",
      "2,000 mensajes IA/mes",
      "Plataformas ilimitadas",
      "Templates ilimitados",
      "Reportes ilimitados",
      "Price Advisor",
      "Multi-modelo IA",
      "Export CSV + JSON",
    ],
    cta: "Elegir Pro",
    popular: true,
    planId: "pro",
  },
  {
    name: "Business",
    price: "Custom",
    priceDetail: "contactanos",
    description: "Para agencias y equipos",
    features: [
      "Todo en Pro",
      "Mensajes IA ilimitados",
      "API access",
      "Soporte prioritario",
      "Onboarding dedicado",
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
              Empieza gratis. Actualiza cuando lo necesites.
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
            // Mobile: horizontal scroll
            "flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory sm:overflow-visible sm:pb-0",
            // Desktop: grid
            "sm:grid sm:grid-cols-2 lg:grid-cols-4"
          )}
        >
          {plans.map((plan) => {
            const isCurrent = currentPlan === plan.name.toLowerCase();
            return (
              <div
                key={plan.name}
                className={cn(
                  "relative flex-shrink-0 snap-center rounded-xl border p-5 transition-colors sm:p-6",
                  // Mobile: fixed width cards
                  "w-[280px] sm:w-auto",
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
                    {" "}
                    {plan.priceDetail}
                  </span>
                </div>

                <ul className="mt-6 space-y-2.5">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-sm text-gray-300"
                    >
                      <svg
                        className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      {feature}
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
                      href="mailto:hello@fanflow.app"
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
      </div>
    </section>
  );
}
