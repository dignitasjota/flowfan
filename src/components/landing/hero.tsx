import Link from "next/link";

export function Hero() {
  return (
    <section className="relative overflow-hidden px-6 py-24 sm:py-32 lg:px-8">
      {/* Background gradients */}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(45rem_50rem_at_top,theme(--color-indigo-900/30),transparent)]" />
      <div className="absolute right-0 top-0 -z-10 h-96 w-96 bg-[radial-gradient(circle,theme(--color-purple-900/20),transparent)]" />

      <div className="mx-auto max-w-4xl text-center">
        {/* Badge */}
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-1.5 text-sm text-indigo-300">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
          </span>
          Plataforma completa para creadores
        </div>

        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl">
          Gestiona tus fans con{" "}
          <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            inteligencia artificial
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-gray-300">
          El CRM todo-en-uno para creadores de contenido. IA conversacional,
          scoring automatico, Telegram en vivo, broadcasts masivos, equipo de
          chatters y mucho mas. Todo desde un solo panel.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/register"
            className="w-full rounded-lg bg-indigo-600 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 hover:bg-indigo-500 transition-all hover:shadow-indigo-500/40 sm:w-auto"
          >
            Empieza gratis — sin tarjeta
          </Link>
          <a
            href="#features"
            className="w-full rounded-lg border border-gray-600 px-8 py-3.5 text-sm font-semibold text-gray-300 hover:bg-gray-800 transition-colors sm:w-auto"
          >
            Ver funcionalidades
          </a>
        </div>

        {/* Stats */}
        <div className="mt-16 grid grid-cols-3 gap-8">
          {[
            { value: "8+", label: "Plataformas" },
            { value: "5", label: "Proveedores IA" },
            { value: "< 2s", label: "Respuesta IA" },
          ].map((stat) => (
            <div key={stat.label}>
              <div className="text-2xl font-bold text-white sm:text-3xl">{stat.value}</div>
              <div className="mt-1 text-xs text-gray-500 sm:text-sm">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Dashboard mockup */}
      <div className="mx-auto mt-20 max-w-5xl">
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-3 shadow-2xl shadow-indigo-500/5 sm:p-4">
          {/* Window chrome */}
          <div className="mb-3 flex items-center gap-2 sm:mb-4">
            <div className="h-3 w-3 rounded-full bg-red-500/80" />
            <div className="h-3 w-3 rounded-full bg-yellow-500/80" />
            <div className="h-3 w-3 rounded-full bg-green-500/80" />
            <div className="ml-4 flex-1 rounded-md bg-gray-800 px-3 py-1">
              <span className="text-[10px] text-gray-500 sm:text-xs">flowfan.app/conversations</span>
            </div>
          </div>

          {/* Dashboard layout */}
          <div className="flex gap-3 sm:gap-4">
            {/* Sidebar mockup */}
            <div className="hidden w-40 flex-shrink-0 space-y-1.5 rounded-lg bg-gray-950 p-3 sm:block">
              <div className="mb-3 text-sm font-bold text-white">FanFlow</div>
              {["Dashboard", "Conversaciones", "Contactos", "Segmentos", "Broadcasts", "Programados"].map((item, i) => (
                <div
                  key={item}
                  className={`rounded px-2.5 py-1.5 text-[11px] ${i === 1 ? "bg-gray-800 text-white" : "text-gray-500"}`}
                >
                  {item}
                </div>
              ))}
            </div>

            {/* Chat list */}
            <div className="w-1/3 space-y-1.5 sm:w-auto sm:min-w-[180px]">
              {[
                { name: "@maria_vip", msg: "Me encanta tu contenido!", badge: "VIP", color: "text-amber-400" },
                { name: "@carlos_92", msg: "Cuanto cuesta el PPV?", badge: "Hot", color: "text-red-400" },
                { name: "@ana_buyer", msg: "Quiero algo exclusivo", badge: "Buyer", color: "text-green-400" },
              ].map((chat) => (
                <div key={chat.name} className="rounded-lg bg-gray-800 p-2 sm:p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-white sm:text-xs">{chat.name}</span>
                    <span className={`text-[9px] font-medium ${chat.color}`}>{chat.badge}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[10px] text-gray-500">{chat.msg}</p>
                </div>
              ))}
            </div>

            {/* Chat area */}
            <div className="flex flex-1 flex-col">
              <div className="flex-1 space-y-2">
                <div className="mr-auto max-w-[80%] rounded-2xl bg-gray-800 px-3 py-2 text-[11px] text-white sm:text-xs">
                  Hola! Me encanta lo que haces. Tienes algo especial para mi?
                </div>
                <div className="ml-auto max-w-[80%] rounded-2xl bg-indigo-600 px-3 py-2 text-[11px] text-white sm:text-xs">
                  Gracias! Tengo contenido exclusivo que te va a encantar
                </div>
                {/* AI suggestion */}
                <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-2 sm:p-2.5">
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className="rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[9px] font-medium text-blue-300">casual</span>
                    <span className="rounded-full bg-green-500/20 px-1.5 py-0.5 text-[9px] font-medium text-green-300">ventas</span>
                    <span className="rounded-full bg-purple-500/20 px-1.5 py-0.5 text-[9px] font-medium text-purple-300">retencion</span>
                  </div>
                  <p className="text-[10px] text-indigo-200 sm:text-[11px]">
                    IA: 3 variantes generadas en 1.2s
                  </p>
                </div>
              </div>
            </div>

            {/* Contact panel */}
            <div className="hidden w-44 flex-shrink-0 space-y-2 rounded-lg bg-gray-800/50 p-2.5 lg:block">
              <div className="text-[11px] font-medium text-white">@maria_vip</div>
              <div className="space-y-1.5">
                {[
                  { label: "Engagement", value: "87%", color: "bg-green-500" },
                  { label: "Pago", value: "72%", color: "bg-amber-500" },
                  { label: "Funnel", value: "VIP", color: "bg-indigo-500" },
                ].map((stat) => (
                  <div key={stat.label}>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-gray-500">{stat.label}</span>
                      <span className="text-gray-300">{stat.value}</span>
                    </div>
                    <div className="mt-0.5 h-1 rounded-full bg-gray-700">
                      <div className={`h-1 rounded-full ${stat.color}`} style={{ width: stat.value }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {["premium", "activa", "OF"].map((tag) => (
                  <span key={tag} className="rounded bg-gray-700 px-1.5 py-0.5 text-[9px] text-gray-400">{tag}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
