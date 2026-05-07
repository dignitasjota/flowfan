"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const PLATFORM_ICONS: Record<string, string> = {
  instagram: "📷",
  reddit: "👽",
  twitter: "🐦",
  onlyfans: "🌶️",
  telegram: "✈️",
  tinder: "🔥",
  snapchat: "👻",
  other: "🌐",
};

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  reddit: "Reddit",
  twitter: "Twitter / X",
  onlyfans: "OnlyFans",
  telegram: "Telegram",
  tinder: "Tinder",
  snapchat: "Snapchat",
  other: "Otro",
};

const FUNNEL_LABELS: Record<string, string> = {
  cold: "Frío",
  curious: "Curioso",
  interested: "Interesado",
  hot_lead: "Hot Lead",
  buyer: "Comprador",
  vip: "VIP",
};

const FUNNEL_COLORS: Record<string, string> = {
  cold: "bg-gray-500",
  curious: "bg-blue-500",
  interested: "bg-cyan-500",
  hot_lead: "bg-amber-500",
  buyer: "bg-emerald-500",
  vip: "bg-purple-500",
};

const FUNNEL_ORDER = [
  "cold",
  "curious",
  "interested",
  "hot_lead",
  "buyer",
  "vip",
] as const;

function formatCents(cents: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

export default function InsightsPage() {
  const [period, setPeriod] = useState<7 | 30 | 90>(30);
  const insights = trpc.intelligence.audienceInsights.useQuery({
    sinceDays: period,
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Audience Insights</h1>
          <p className="text-sm text-gray-400">
            Comparativa por plataforma: engagement, conversión, revenue y
            temas más demandados.
          </p>
        </div>
        <div className="flex gap-1">
          {([7, 30, 90] as const).map((d) => (
            <button
              key={d}
              onClick={() => setPeriod(d)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition",
                period === d
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white"
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {insights.isLoading ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-12 text-center text-sm text-gray-500">
          Cargando datos...
        </div>
      ) : !insights.data || insights.data.perPlatform.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-12 text-center">
          <div className="mb-2 text-4xl">📊</div>
          <h2 className="text-lg font-semibold text-white">
            Aún no hay datos suficientes
          </h2>
          <p className="mt-1 text-sm text-gray-400">
            Cuando empieces a recibir mensajes y comentarios, aquí verás la
            comparativa de tu audiencia por plataforma.
          </p>
        </div>
      ) : (
        <>
          {/* Top-line totals */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="Contactos totales"
              value={insights.data.totals.contactCount.toLocaleString("es-ES")}
            />
            <StatCard
              label="Engagement medio"
              value={`${insights.data.totals.avgEngagement}/100`}
            />
            <StatCard
              label="Conversión global"
              value={`${insights.data.totals.conversionRate}%`}
              hint="contactos en buyer + vip"
            />
            <StatCard
              label={`Revenue ${period}d`}
              value={formatCents(insights.data.totals.revenueCents)}
            />
          </div>

          {/* Per-platform cards */}
          <div className="grid gap-4 md:grid-cols-2">
            {insights.data.perPlatform.map((p) => (
              <PlatformCard key={p.platformType} insights={p} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

type PlatformInsightsRow = {
  platformType: string;
  contactCount: number;
  avgEngagement: number;
  avgPayment: number;
  avgChurn: number;
  funnelDistribution: Record<string, number>;
  conversionRate: number;
  revenueCents: number;
  transactionCount: number;
  topTopics: { topic: string; frequency: number }[];
};

function PlatformCard({ insights }: { insights: PlatformInsightsRow }) {
  const total = insights.contactCount;

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">
            {PLATFORM_ICONS[insights.platformType] ?? "🌐"}
          </span>
          <h3 className="text-lg font-semibold text-white">
            {PLATFORM_LABELS[insights.platformType] ?? insights.platformType}
          </h3>
        </div>
        <span className="text-sm text-gray-400">
          {total.toLocaleString("es-ES")} contactos
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Mini label="Engagement" value={`${insights.avgEngagement}`} />
        <Mini label="Pago" value={`${insights.avgPayment}`} />
        <Mini label="Conversión" value={`${insights.conversionRate}%`} />
        <Mini
          label="Revenue"
          value={formatCents(insights.revenueCents)}
          tone={insights.revenueCents > 0 ? "good" : undefined}
        />
      </div>

      {/* Funnel distribution bar */}
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
          <span>Distribución del funnel</span>
          <span className="text-gray-500">
            churn medio {insights.avgChurn}/100
          </span>
        </div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-800">
          {FUNNEL_ORDER.map((stage) => {
            const count = insights.funnelDistribution[stage] ?? 0;
            const pct = total > 0 ? (count / total) * 100 : 0;
            if (pct === 0) return null;
            return (
              <div
                key={stage}
                className={cn("h-full", FUNNEL_COLORS[stage])}
                style={{ width: `${pct}%` }}
                title={`${FUNNEL_LABELS[stage]}: ${count}`}
              />
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {FUNNEL_ORDER.map((stage) => {
            const count = insights.funnelDistribution[stage] ?? 0;
            if (count === 0) return null;
            return (
              <span
                key={stage}
                className="flex items-center gap-1 text-gray-400"
              >
                <span
                  className={cn("h-2 w-2 rounded-full", FUNNEL_COLORS[stage])}
                />
                {FUNNEL_LABELS[stage]} · {count}
              </span>
            );
          })}
        </div>
      </div>

      {/* Top topics */}
      {insights.topTopics.length > 0 && (
        <div>
          <div className="mb-2 text-xs text-gray-400">Top temas</div>
          <div className="flex flex-wrap gap-1.5">
            {insights.topTopics.map((t) => (
              <span
                key={t.topic}
                className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-300"
                title={`Frecuencia: ${t.frequency}`}
              >
                {t.topic}{" "}
                <span className="text-indigo-400/60">·{t.frequency}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Mini({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good";
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-gray-800 bg-gray-950/40 p-2",
        tone === "good" && "border-emerald-500/30 bg-emerald-500/5"
      )}
    >
      <div className="text-[10px] uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div
        className={cn(
          "text-sm font-semibold text-white",
          tone === "good" && "text-emerald-300"
        )}
      >
        {value}
      </div>
    </div>
  );
}
