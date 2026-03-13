"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const faqs = [
  {
    question: "¿Que es FanFlow?",
    answer:
      "FanFlow es un CRM con inteligencia artificial diseñado para creadores de contenido. Te ayuda a gestionar conversaciones con fans, generar respuestas inteligentes y maximizar tus ingresos.",
  },
  {
    question: "¿Como funciona la IA?",
    answer:
      "La IA analiza el contexto de cada conversacion, el perfil del fan y la personalidad que configures para cada plataforma. Genera sugerencias de respuesta adaptadas que puedes usar con un click.",
  },
  {
    question: "¿Puedo usar mi propia API key de IA?",
    answer:
      "Si. FanFlow soporta Anthropic (Claude), OpenAI (GPT-4), Google (Gemini) y mas. Configuras tu propia API key y eliges el modelo que prefieras para cada tarea.",
  },
  {
    question: "¿Es seguro? ¿Quien ve mis conversaciones?",
    answer:
      "Tus datos son privados. Cada creador tiene su espacio aislado. Las conversaciones se envian a la IA solo cuando generas sugerencias, usando tu propia API key.",
  },
  {
    question: "¿Puedo cancelar en cualquier momento?",
    answer:
      "Si. Puedes cancelar tu suscripcion desde el panel de billing. Al cancelar, mantienes acceso hasta el final del periodo de facturacion y luego vuelves al plan Free.",
  },
  {
    question: "¿Que pasa si llego al limite de mi plan?",
    answer:
      "Recibiras un aviso cuando te acerques a los limites. Si los alcanzas, las funciones limitadas se pausan hasta que actualices tu plan o empiece un nuevo ciclo de facturacion.",
  },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="px-6 py-24 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-center text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Preguntas frecuentes
        </h2>

        <div className="mt-12 space-y-2">
          {faqs.map((faq, i) => (
            <div
              key={i}
              className="rounded-lg border border-gray-800 bg-gray-900"
            >
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="flex w-full items-center justify-between px-6 py-4 text-left"
              >
                <span className="text-sm font-medium text-white">
                  {faq.question}
                </span>
                <svg
                  className={cn(
                    "h-5 w-5 flex-shrink-0 text-gray-400 transition-transform",
                    openIndex === i && "rotate-180"
                  )}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {openIndex === i && (
                <div className="border-t border-gray-800 px-6 py-4">
                  <p className="text-sm text-gray-400">{faq.answer}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
