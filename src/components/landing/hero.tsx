import Link from "next/link";

export function Hero() {
  return (
    <section className="relative overflow-hidden px-6 py-24 sm:py-32 lg:px-8">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(45rem_50rem_at_top,theme(--color-indigo-900/30),transparent)]" />
      <div className="mx-auto max-w-4xl text-center">
        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl">
          Gestiona tus fans con{" "}
          <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            inteligencia artificial
          </span>
        </h1>
        <p className="mt-6 text-lg leading-8 text-gray-300">
          FanFlow es el CRM con IA para creadores de contenido. Responde
          mensajes mas rapido, entiende a tus fans y maximiza tus ingresos con
          sugerencias inteligentes.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            href="/register"
            className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 transition-colors"
          >
            Empieza gratis
          </Link>
          <a
            href="#pricing"
            className="rounded-lg border border-gray-600 px-6 py-3 text-sm font-semibold text-gray-300 hover:bg-gray-800 transition-colors"
          >
            Ver planes
          </a>
        </div>
      </div>

      {/* Mockup visual */}
      <div className="mx-auto mt-16 max-w-3xl">
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 shadow-2xl">
          <div className="flex gap-2 mb-4">
            <div className="h-3 w-3 rounded-full bg-red-500" />
            <div className="h-3 w-3 rounded-full bg-yellow-500" />
            <div className="h-3 w-3 rounded-full bg-green-500" />
          </div>
          <div className="flex gap-4">
            <div className="w-1/3 space-y-2">
              {["@fan_maria", "@carlos_vip", "@ana_buyer"].map((name) => (
                <div
                  key={name}
                  className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-300"
                >
                  {name}
                </div>
              ))}
            </div>
            <div className="flex-1 space-y-3">
              <div className="mr-auto max-w-[70%] rounded-2xl bg-gray-800 px-4 py-2 text-sm text-white">
                Hola! Me encanta tu contenido
              </div>
              <div className="ml-auto max-w-[70%] rounded-2xl bg-indigo-600 px-4 py-2 text-sm text-white">
                Gracias! Tengo contenido exclusivo que te encantaria
              </div>
              <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-300">
                IA: Sugerencia generada en 1.2s
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
