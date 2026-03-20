const featureCategories = [
  {
    title: "Inteligencia Artificial",
    description: "IA potente integrada en cada parte del flujo de trabajo.",
    features: [
      {
        name: "Sugerencias IA multi-variante",
        description:
          "Genera 3 variantes de respuesta (casual, ventas, retencion) adaptadas al contexto, plataforma y perfil del fan. En menos de 2 segundos.",
        icon: (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
        ),
        color: "text-blue-400 bg-blue-500/10",
      },
      {
        name: "Multi-proveedor IA",
        description:
          "Usa Anthropic Claude, OpenAI GPT-4, Google Gemini, Minimax o Kimi. Configura modelos distintos por tarea (sugerencias, analisis, reportes).",
        icon: (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
        ),
        color: "text-purple-400 bg-purple-500/10",
      },
      {
        name: "Scoring automatico",
        description:
          "Analisis continuo de engagement, probabilidad de pago, velocidad de respuesta, profundidad de conversacion y etapa del funnel. Todo automatico.",
        icon: (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
        ),
        color: "text-green-400 bg-green-500/10",
      },
      {
        name: "Reportes y Price Advisor",
        description:
          "Reportes detallados por contacto con insights de comportamiento. El Price Advisor recomienda precios personalizados basados en cada perfil.",
        icon: (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        color: "text-amber-400 bg-amber-500/10",
      },
    ],
  },
  {
    title: "Comunicacion y Alcance",
    description: "Todas las herramientas para llegar a tus fans en el momento justo.",
    features: [
      {
        name: "Telegram Bot en vivo",
        description:
          "Conecta tu bot de Telegram y recibe mensajes en tiempo real. Responde desde FanFlow o activa auto-respuestas con IA.",
        icon: (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
          </svg>
        ),
        color: "text-sky-400 bg-sky-500/10",
      },
      {
        name: "Broadcasts masivos",
        description:
          "Envio masivo a segmentos de fans con variables personalizadas. Envio automatico por Telegram, copia manual para otras plataformas.",
        icon: (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46" />
          </svg>
        ),
        color: "text-orange-400 bg-orange-500/10",
      },
      {
        name: "Mensajes programados",
        description:
          "Programa mensajes para enviar en el momento optimo. La IA sugiere el mejor horario basado en los patrones de actividad del fan.",
        icon: (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        color: "text-cyan-400 bg-cyan-500/10",
      },
      {
        name: "Templates con variables",
        description:
          "Crea templates reutilizables con variables dinamicas (nombre, plataforma). Adapta automaticamente cada respuesta al contexto.",
        icon: (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
          </svg>
        ),
        color: "text-teal-400 bg-teal-500/10",
      },
    ],
  },
  {
    title: "Gestion y Equipo",
    description: "Escala tu operacion con herramientas profesionales.",
    features: [
      {
        name: "Equipo de chatters",
        description:
          "Invita miembros a tu equipo con roles (owner, manager, chatter). Asigna conversaciones, controla permisos y escala sin perder el control.",
        icon: (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
          </svg>
        ),
        color: "text-pink-400 bg-pink-500/10",
      },
      {
        name: "Segmentacion avanzada",
        description:
          "Crea segmentos dinamicos por tags, funnel stage, plataforma, engagement o gasto. Usa segmentos para broadcasts y analisis.",
        icon: (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
          </svg>
        ),
        color: "text-rose-400 bg-rose-500/10",
      },
      {
        name: "Revenue tracking",
        description:
          "Registra tips, PPV, suscripciones y pagos custom por fan. Visualiza el ROI real de tu tiempo de chat con graficos y metricas.",
        icon: (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
          </svg>
        ),
        color: "text-emerald-400 bg-emerald-500/10",
      },
      {
        name: "Media Vault y Workflows",
        description:
          "Almacen de contenido multimedia con tracking de envios. Automatizaciones con triggers configurables (timeout, keywords, funnel change).",
        icon: (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
          </svg>
        ),
        color: "text-yellow-400 bg-yellow-500/10",
      },
    ],
  },
];

export function Features() {
  return (
    <section id="features" className="px-6 py-24 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Todo lo que necesitas para gestionar tus fans
          </h2>
          <p className="mt-4 text-lg text-gray-400">
            12 herramientas potenciadas por IA en una sola plataforma.
          </p>
        </div>

        <div className="mt-20 space-y-24">
          {featureCategories.map((category, catIdx) => (
            <div key={category.title}>
              <div className="mb-8 flex items-center gap-4">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-700 to-transparent" />
                <div className="text-center">
                  <h3 className="text-xl font-semibold text-white">{category.title}</h3>
                  <p className="mt-1 text-sm text-gray-500">{category.description}</p>
                </div>
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-700 to-transparent" />
              </div>

              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {category.features.map((feature) => (
                  <div
                    key={feature.name}
                    className="group rounded-xl border border-gray-800 bg-gray-900 p-6 transition-all hover:border-gray-700 hover:bg-gray-900/80"
                  >
                    <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${feature.color}`}>
                      {feature.icon}
                    </div>
                    <h4 className="text-sm font-semibold text-white">
                      {feature.name}
                    </h4>
                    <p className="mt-2 text-[13px] leading-relaxed text-gray-400">
                      {feature.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
