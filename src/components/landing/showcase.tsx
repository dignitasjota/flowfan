"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const tabs = [
  {
    id: "chat",
    label: "Chat con IA",
    description: "Genera respuestas inteligentes con variantes adaptadas a cada fan.",
  },
  {
    id: "scoring",
    label: "Scoring & Perfil",
    description: "Perfil detallado de cada fan con metricas de engagement y comportamiento.",
  },
  {
    id: "broadcasts",
    label: "Broadcasts",
    description: "Envio masivo a segmentos con variables personalizadas y seguimiento en tiempo real.",
  },
  {
    id: "team",
    label: "Equipo",
    description: "Gestiona tu equipo de chatters con roles y asignaciones de conversaciones.",
  },
];

function ChatMockup() {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-gray-800 px-4 py-3">
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-pink-500 to-purple-500" />
        <div>
          <div className="text-xs font-semibold text-white">@jessica_premium</div>
          <div className="text-[10px] text-gray-500">OnlyFans</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium text-amber-400">VIP</span>
          <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[9px] font-medium text-green-400">87%</span>
        </div>
      </div>
      {/* Messages */}
      <div className="flex-1 space-y-2.5 p-4">
        <div className="mr-auto max-w-[75%] rounded-2xl bg-gray-800 px-3 py-2 text-[11px] text-white">
          Hey! Vi tu nuevo set, esta increible. Tienes algo mas exclusivo?
        </div>
        <div className="ml-auto max-w-[75%] rounded-2xl bg-indigo-600 px-3 py-2 text-[11px] text-white">
          Hola jessica! Me alegra que te guste. Tengo un set especial que no he publicado
        </div>
        <div className="mr-auto max-w-[75%] rounded-2xl bg-gray-800 px-3 py-2 text-[11px] text-white">
          Oooh, cuanto es? Quiero verlo ya!
        </div>
      </div>
      {/* AI suggestions */}
      <div className="border-t border-gray-800 bg-gray-900/50 p-3">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-gray-500">Sugerencias IA</div>
        <div className="space-y-1.5">
          {[
            { type: "casual", color: "border-blue-500/40 text-blue-300", text: "Claro! Te mando un preview gratis y me dices que te parece..." },
            { type: "ventas", color: "border-green-500/40 text-green-300", text: "Este set es de mis favoritos! Son 25$ y te incluyo 3 fotos extras..." },
            { type: "retencion", color: "border-purple-500/40 text-purple-300", text: "Para fans VIP como tu tengo un precio especial de 20$..." },
          ].map((s) => (
            <div key={s.type} className="flex items-center gap-2 rounded border border-gray-700 bg-gray-800 p-2">
              <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-medium uppercase ${s.color}`}>{s.type}</span>
              <span className="flex-1 truncate text-[10px] text-gray-300">{s.text}</span>
              <button className="flex-shrink-0 rounded bg-indigo-600 px-2 py-0.5 text-[9px] font-medium text-white">Usar</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScoringMockup() {
  return (
    <div className="flex h-full flex-col p-4">
      {/* Contact header */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-red-500 text-sm font-bold text-white">JC</div>
        <div>
          <div className="text-sm font-semibold text-white">@jessica_premium</div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500">OnlyFans</span>
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium text-amber-400">VIP</span>
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-lg font-bold text-white">$485</div>
          <div className="text-[10px] text-gray-500">Total revenue</div>
        </div>
      </div>
      {/* Scoring bars */}
      <div className="space-y-3">
        {[
          { label: "Engagement Level", value: 87, color: "bg-green-500" },
          { label: "Payment Probability", value: 72, color: "bg-amber-500" },
          { label: "Response Speed", value: "Rapido", bar: 90, color: "bg-blue-500" },
        ].map((m) => (
          <div key={m.label}>
            <div className="flex justify-between text-[11px]">
              <span className="text-gray-400">{m.label}</span>
              <span className="font-medium text-white">{typeof m.value === "number" ? `${m.value}%` : m.value}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-gray-800">
              <div className={`h-2 rounded-full ${m.color} transition-all`} style={{ width: `${m.bar ?? m.value}%` }} />
            </div>
          </div>
        ))}
      </div>
      {/* Funnel + Tags */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-gray-800 bg-gray-800/50 p-3">
          <div className="text-[10px] text-gray-500">Funnel Stage</div>
          <div className="mt-1 flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-amber-400" />
            <span className="text-xs font-medium text-white">VIP</span>
          </div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-800/50 p-3">
          <div className="text-[10px] text-gray-500">Estimated Budget</div>
          <div className="mt-1 text-xs font-medium text-white">Premium ($$$)</div>
        </div>
      </div>
      {/* Tags */}
      <div className="mt-3">
        <div className="text-[10px] text-gray-500">Tags</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {["premium", "activa", "OF", "PPV-buyer", "top-spender"].map((t) => (
            <span key={t} className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] text-gray-400">{t}</span>
          ))}
        </div>
      </div>
      {/* Behavioral signals */}
      <div className="mt-4 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3">
        <div className="text-[10px] font-medium text-indigo-300">Signals detectados por IA</div>
        <ul className="mt-1.5 space-y-1 text-[10px] text-gray-400">
          <li>Alta frecuencia de compra en ultimas 2 semanas</li>
          <li>Responde rapido a mensajes con contenido exclusivo</li>
          <li>Patron de actividad: 19h-23h zona horaria EST</li>
        </ul>
      </div>
    </div>
  );
}

function BroadcastsMockup() {
  return (
    <div className="flex h-full flex-col p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-white">Mis Broadcasts</div>
          <div className="text-[10px] text-gray-500">3 enviados este mes</div>
        </div>
        <button className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[10px] font-medium text-white">+ Nuevo</button>
      </div>
      {/* Broadcast list */}
      <div className="space-y-2">
        {[
          { name: "Promo Fin de Semana", status: "completed", sent: 245, failed: 3, date: "Hace 2h", color: "bg-green-500/10 text-green-400 border-green-500/30" },
          { name: "Contenido Exclusivo VIP", status: "sending", sent: 89, failed: 0, date: "Ahora", color: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
          { name: "Descuento 30%", status: "scheduled", sent: 0, failed: 0, date: "Manana 19:00", color: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
        ].map((bc) => (
          <div key={bc.name} className="rounded-lg border border-gray-800 bg-gray-800/50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-white">{bc.name}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[9px] font-medium ${bc.color}`}>
                {bc.status === "completed" ? "Completado" : bc.status === "sending" ? "Enviando..." : "Programado"}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-4 text-[10px] text-gray-500">
              <span>{bc.date}</span>
              {bc.sent > 0 && <span className="text-green-400">{bc.sent} enviados</span>}
              {bc.failed > 0 && <span className="text-red-400">{bc.failed} fallidos</span>}
            </div>
            {bc.status === "sending" && (
              <div className="mt-2 h-1.5 rounded-full bg-gray-700">
                <div className="h-1.5 animate-pulse rounded-full bg-blue-500" style={{ width: "65%" }} />
              </div>
            )}
          </div>
        ))}
      </div>
      {/* Segment preview */}
      <div className="mt-4 rounded-lg border border-gray-800 bg-gray-900 p-3">
        <div className="text-[10px] font-medium text-gray-400">Segmento: Fans VIP activos</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {["funnel: vip", "engagement > 70%", "ultima visita: 7d"].map((f) => (
            <span key={f} className="rounded bg-indigo-500/10 px-2 py-0.5 text-[9px] text-indigo-300">{f}</span>
          ))}
        </div>
        <div className="mt-2 text-[10px] text-gray-500">248 contactos coinciden</div>
      </div>
    </div>
  );
}

function TeamMockup() {
  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-white">Mi Equipo</div>
          <div className="text-[10px] text-gray-500">3 miembros activos</div>
        </div>
        <button className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[10px] font-medium text-white">Invitar</button>
      </div>
      {/* Team members */}
      <div className="space-y-2">
        {[
          { name: "Tu (Owner)", email: "creator@email.com", role: "owner", color: "bg-amber-500/10 text-amber-400", convs: 42 },
          { name: "Laura M.", email: "laura@email.com", role: "manager", color: "bg-blue-500/10 text-blue-400", convs: 28 },
          { name: "Carlos R.", email: "carlos@email.com", role: "chatter", color: "bg-gray-500/10 text-gray-400", convs: 15 },
        ].map((m) => (
          <div key={m.name} className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-800/50 p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-700 text-[10px] font-bold text-white">
              {m.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white">{m.name}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-medium ${m.color}`}>{m.role}</span>
              </div>
              <div className="text-[10px] text-gray-500">{m.email}</div>
            </div>
            <div className="text-right">
              <div className="text-xs font-medium text-white">{m.convs}</div>
              <div className="text-[9px] text-gray-500">convs</div>
            </div>
          </div>
        ))}
      </div>
      {/* Assignments */}
      <div className="mt-4">
        <div className="mb-2 text-[10px] font-medium text-gray-400">Asignaciones recientes</div>
        <div className="space-y-1.5">
          {[
            { contact: "@fan_maria", assignee: "Carlos R.", platform: "Telegram" },
            { contact: "@premium_user", assignee: "Laura M.", platform: "OnlyFans" },
          ].map((a) => (
            <div key={a.contact} className="flex items-center justify-between rounded bg-gray-800/50 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white">{a.contact}</span>
                <span className="text-[9px] text-gray-600">{a.platform}</span>
              </div>
              <span className="text-[10px] text-indigo-400">{a.assignee}</span>
            </div>
          ))}
        </div>
      </div>
      {/* Invite link */}
      <div className="mt-4 rounded-lg border border-dashed border-gray-700 bg-gray-900/50 p-3 text-center">
        <div className="text-[10px] text-gray-400">Invitacion pendiente</div>
        <div className="mt-1 text-[10px] text-indigo-400">nuevo@email.com — chatter</div>
        <div className="mt-1 text-[9px] text-gray-600">Expira en 6 dias</div>
      </div>
    </div>
  );
}

const mockups: Record<string, () => React.JSX.Element> = {
  chat: ChatMockup,
  scoring: ScoringMockup,
  broadcasts: BroadcastsMockup,
  team: TeamMockup,
};

export function Showcase() {
  const [activeTab, setActiveTab] = useState("chat");
  const MockupComponent = mockups[activeTab]!;

  return (
    <section id="showcase" className="px-6 py-24 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Mira FlowFan en accion
          </h2>
          <p className="mt-4 text-lg text-gray-400">
            Explora las pantallas principales del panel de control.
          </p>
        </div>

        {/* Tabs */}
        <div className="mt-12 flex flex-wrap justify-center gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-medium transition-all",
                activeTab === tab.id
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Description */}
        <p className="mt-4 text-center text-sm text-gray-500">
          {tabs.find((t) => t.id === activeTab)?.description}
        </p>

        {/* Mockup window */}
        <div className="mt-8 overflow-hidden rounded-xl border border-gray-800 bg-gray-900 shadow-2xl shadow-indigo-500/5">
          {/* Window chrome */}
          <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-2.5">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/80" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-500/80" />
            <div className="ml-4 flex-1 rounded bg-gray-800 px-3 py-1">
              <span className="text-[10px] text-gray-500">flowfan.app/{activeTab === "chat" ? "conversations" : activeTab === "scoring" ? "contacts" : activeTab}</span>
            </div>
          </div>
          {/* Content */}
          <div className="h-[420px] overflow-hidden sm:h-[460px]">
            <MockupComponent />
          </div>
        </div>
      </div>
    </section>
  );
}
