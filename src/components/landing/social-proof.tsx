/**
 * Honest social proof: numbers reflect product capabilities, not customer
 * counts. When real adoption metrics are available, swap the data here.
 */
const PLATFORMS = [
  { name: "OnlyFans", emoji: "🌶️" },
  { name: "Telegram", emoji: "✈️" },
  { name: "Instagram", emoji: "📷" },
  { name: "Reddit", emoji: "👽" },
  { name: "Twitter / X", emoji: "🐦" },
  { name: "Snapchat", emoji: "👻" },
  { name: "Tinder", emoji: "🔥" },
];

const CAPABILITY_STATS = [
  {
    label: "Modelos IA integrados",
    value: "5",
    detail: "Anthropic, OpenAI, Google, MiniMax, Kimi",
  },
  {
    label: "Eventos webhook",
    value: "9",
    detail: "Comments, posts, transactions, scoring...",
  },
  {
    label: "Idiomas en respuestas IA",
    value: "6",
    detail: "ES · EN · PT · FR · DE · IT",
  },
  {
    label: "Latencia respuesta IA",
    value: "< 2s",
    detail: "Multi-proveedor con failover",
  },
];

export function SocialProof() {
  return (
    <section className="border-y border-gray-800/50 bg-gray-900/20 px-6 py-16 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-indigo-400">
            Plataforma completa, integrada de fábrica
          </p>
          <h2 className="mt-3 text-3xl font-bold text-white sm:text-4xl">
            Todo lo que necesitas para operar al 100%
          </h2>
        </div>

        {/* Capability stats */}
        <div className="mt-12 grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-4">
          {CAPABILITY_STATS.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 text-center"
            >
              <div className="text-3xl font-bold text-white sm:text-4xl">
                {stat.value}
              </div>
              <div className="mt-2 text-xs font-medium text-gray-300">
                {stat.label}
              </div>
              <div className="mt-1 text-[11px] text-gray-500">{stat.detail}</div>
            </div>
          ))}
        </div>

        {/* Supported platforms */}
        <div className="mt-12">
          <p className="text-center text-xs font-medium uppercase tracking-wider text-gray-500">
            Plataformas soportadas
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            {PLATFORMS.map((p) => (
              <div
                key={p.name}
                className="flex items-center gap-2 rounded-full border border-gray-800 bg-gray-900/60 px-4 py-2 text-sm text-gray-300"
              >
                <span className="text-base">{p.emoji}</span>
                <span>{p.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
