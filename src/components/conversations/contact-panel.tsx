"use client";

import { cn } from "@/lib/utils";

type Contact = {
  id: string;
  username: string;
  displayName: string | null;
  platformType: string;
  firstInteractionAt: Date;
  totalConversations: number;
  tags: string[] | null;
  profile: {
    engagementLevel: number;
    funnelStage: string;
    paymentProbability: number;
    estimatedBudget: string | null;
    responseSpeed: string | null;
    conversationDepth: string | null;
  } | null;
};

const funnelLabels: Record<string, string> = {
  cold: "Frío",
  curious: "Curioso",
  interested: "Interesado",
  hot_lead: "Comprador potencial",
  buyer: "Comprador",
  vip: "VIP",
};

const funnelColors: Record<string, string> = {
  cold: "text-gray-400",
  curious: "text-blue-400",
  interested: "text-yellow-400",
  hot_lead: "text-orange-400",
  buyer: "text-green-400",
  vip: "text-purple-400",
};

type Props = {
  contact: Contact;
  onBack?: () => void;
};

export function ContactPanel({ contact, onBack }: Props) {
  const profile = contact.profile;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Back button (mobile) */}
      {onBack && (
        <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-3 lg:hidden">
          <button
            onClick={onBack}
            className="rounded-lg p-1 text-gray-400 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-medium text-white">Perfil del contacto</span>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-gray-800 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-700 text-lg font-bold text-white">
            {contact.username[0]?.toUpperCase()}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              {contact.displayName || contact.username}
            </h3>
            <p className="text-xs text-gray-400">
              @{contact.username} · {contact.platformType}
            </p>
          </div>
        </div>
      </div>

      {/* Score */}
      {profile && (
        <div className="border-b border-gray-800 px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
              Probabilidad de pago
            </span>
            <span className="text-2xl font-bold text-white">
              {profile.paymentProbability}%
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2 rounded-full bg-gray-800">
            <div
              className={cn(
                "h-2 rounded-full transition-all",
                profile.paymentProbability >= 70
                  ? "bg-green-500"
                  : profile.paymentProbability >= 40
                    ? "bg-yellow-500"
                    : "bg-gray-500"
              )}
              style={{ width: `${profile.paymentProbability}%` }}
            />
          </div>

          <p
            className={cn(
              "mt-2 text-sm font-medium",
              funnelColors[profile.funnelStage] ?? "text-gray-400"
            )}
          >
            {funnelLabels[profile.funnelStage] ?? profile.funnelStage}
          </p>
        </div>
      )}

      {/* Signals */}
      {profile && (
        <div className="border-b border-gray-800 px-4 py-4">
          <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">
            Señales
          </h4>
          <div className="space-y-2">
            <InfoRow
              label="Engagement"
              value={`${profile.engagementLevel}/100`}
            />
            <InfoRow
              label="Velocidad de respuesta"
              value={profile.responseSpeed ?? "—"}
            />
            <InfoRow
              label="Profundidad"
              value={profile.conversationDepth ?? "—"}
            />
            <InfoRow
              label="Presupuesto estimado"
              value={profile.estimatedBudget ?? "—"}
            />
          </div>
        </div>
      )}

      {/* Info */}
      <div className="px-4 py-4">
        <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">
          Información
        </h4>
        <div className="space-y-2">
          <InfoRow
            label="Primera interacción"
            value={new Date(contact.firstInteractionAt).toLocaleDateString(
              "es-ES"
            )}
          />
          <InfoRow
            label="Conversaciones"
            value={String(contact.totalConversations)}
          />
          {contact.tags && contact.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {contact.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-300"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-sm text-white">{value}</span>
    </div>
  );
}
