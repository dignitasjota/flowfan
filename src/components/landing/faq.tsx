"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const faqs = [
  {
    question: "¿Que es FlowFan?",
    answer:
      "FlowFan es un CRM todo-en-uno con inteligencia artificial diseñado para creadores de contenido. Gestiona conversaciones con fans, genera respuestas inteligentes, automatiza envios masivos, administra tu equipo de chatters y trackea revenue — todo desde un solo panel.",
  },
  {
    question: "¿Como funciona la IA?",
    answer:
      "La IA analiza el contexto de cada conversacion, el perfil del fan (scoring, funnel stage, historial) y la personalidad que configures para cada plataforma. Genera 3 variantes de respuesta (casual, ventas, retencion) que puedes usar con un click. Tambien se usa para analisis de sentimiento, scoring automatico, reportes y sugerencias de precio.",
  },
  {
    question: "¿Que proveedores de IA soporta?",
    answer:
      "FlowFan soporta Anthropic (Claude), OpenAI (GPT-4o), Google (Gemini), Minimax y Kimi. Configuras tu propia API key y puedes asignar modelos distintos a cada tarea: un modelo para sugerencias, otro para analisis, otro para reportes.",
  },
  {
    question: "¿Como funciona la integracion con Telegram?",
    answer:
      "Conectas tu bot de Telegram desde la configuracion. Los mensajes de tus fans llegan en tiempo real a FlowFan, y puedes responder directamente desde el panel (o activar auto-respuestas con IA). Tambien puedes enviar broadcasts masivos automaticamente via Telegram.",
  },
  {
    question: "¿Puedo tener chatters trabajando conmigo?",
    answer:
      "Si, a partir del plan Pro. Puedes invitar miembros a tu equipo con roles (owner, manager, chatter). Los chatters solo ven las conversaciones que les asignas, y tu conservas el control total. Cada mensaje queda registrado con quien lo envio.",
  },
  {
    question: "¿Que son los mensajes programados?",
    answer:
      "Puedes programar mensajes individuales para que se envien en el futuro. La IA analiza los patrones de actividad de cada fan y te sugiere el mejor horario para maximizar la probabilidad de respuesta. Disponible desde el plan Starter.",
  },
  {
    question: "¿Es seguro? ¿Quien ve mis conversaciones?",
    answer:
      "Tus datos son 100% privados. Cada creador tiene su espacio aislado (multi-tenant). Los tokens de bots se almacenan con cifrado AES-256. Las conversaciones solo se envian a la IA cuando generas sugerencias, usando tu propia API key. Tu equipo solo ve lo que les permites segun su rol.",
  },
  {
    question: "¿Puedo cancelar en cualquier momento?",
    answer:
      "Si. Puedes cancelar tu suscripcion desde el panel de billing en cualquier momento. Al cancelar, mantienes acceso hasta el final del periodo de facturacion y luego vuelves al plan Free con todos tus datos intactos.",
  },
  {
    question: "¿Que pasa si alcanzo el limite de mi plan?",
    answer:
      "Recibiras un aviso cuando te acerques a los limites. Si los alcanzas, las funciones limitadas se pausan pero no pierdes datos. Puedes actualizar tu plan en cualquier momento para desbloquear mas capacidad, o esperar al inicio del siguiente ciclo de facturacion.",
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
        <p className="mt-4 text-center text-gray-400">
          Todo lo que necesitas saber sobre FlowFan.
        </p>

        <div className="mt-12 space-y-2">
          {faqs.map((faq, i) => (
            <div
              key={i}
              className="rounded-lg border border-gray-800 bg-gray-900 transition-colors hover:border-gray-700"
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
                    "h-5 w-5 flex-shrink-0 text-gray-400 transition-transform duration-200",
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
              <div
                className={cn(
                  "overflow-hidden transition-all duration-200",
                  openIndex === i ? "max-h-96" : "max-h-0"
                )}
              >
                <div className="border-t border-gray-800 px-6 py-4">
                  <p className="text-sm leading-relaxed text-gray-400">{faq.answer}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
