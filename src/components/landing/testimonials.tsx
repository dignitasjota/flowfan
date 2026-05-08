/**
 * Pre-launch testimonials: claramente marcados como ejemplos para la fase
 * de pre-launch. Reemplazar por testimonios verificados antes del lanzamiento
 * público con foto + nombre + handle del creator.
 */

const QUOTES: Array<{
  quote: string;
  role: string;
  highlight: string;
}> = [
  {
    quote:
      "Lo que más me ha sorprendido son las sugerencias por modo conversacional — el sistema sabe cuándo soy intensa y cuándo bajo el ritmo. La IA no se siente como una IA.",
    role: "Creator OnlyFans · 12 meses",
    highlight: "modos conversacionales",
  },
  {
    quote:
      "Recibo comentarios en Reddit y los gestiono en la misma bandeja que los DMs. El polling es inmediato y el scoring del autor cruza datos públicos y privados.",
    role: "Modelo Reddit / Twitter · top 5%",
    highlight: "comentarios públicos",
  },
  {
    quote:
      "Con el agente de chatters configuré roles con permisos granulares y todo está auditado. Sé exactamente quién contestó qué y cuándo.",
    role: "Manager de equipo · 4 chatters",
    highlight: "team + audit log",
  },
  {
    quote:
      "Programar threads de X desde un blog que escribo y que la IA me los adapte automáticamente me ahorra ~3h al día.",
    role: "Influencer Twitter · 90K seguidores",
    highlight: "blog-to-social IA",
  },
];

export function Testimonials() {
  return (
    <section className="px-6 py-20 lg:px-8" id="testimonials">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            Ejemplos de uso · pre-launch
          </span>
          <h2 className="mt-4 text-3xl font-bold text-white sm:text-4xl">
            Casos de uso reales
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-gray-400">
            Estos son escenarios representativos de cómo creators usan FlowFan
            durante la fase de prueba. Reemplazaremos por testimonios verificados
            con permiso explícito tras el lanzamiento público.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {QUOTES.map((q, i) => (
            <figure
              key={i}
              className="rounded-2xl border border-gray-800 bg-gray-900/40 p-6"
            >
              <blockquote className="text-sm leading-relaxed text-gray-200">
                <span className="text-2xl text-indigo-400">"</span>
                {q.quote}
                <span className="text-2xl text-indigo-400">"</span>
              </blockquote>
              <figcaption className="mt-4 flex items-center justify-between border-t border-gray-800 pt-3">
                <span className="text-xs text-gray-500">{q.role}</span>
                <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-indigo-300">
                  {q.highlight}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
