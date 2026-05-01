"use client";

import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const RISK_COLORS = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
};

const STAGE_LABELS: Record<string, string> = {
  cold: "Frio",
  curious: "Curioso",
  interested: "Interesado",
  hot_lead: "Hot Lead",
  buyer: "Comprador",
  vip: "VIP",
};

export function ChurnPanel() {
  const churnData = trpc.intelligence.getChurnDashboard.useQuery();

  if (!churnData.data) return null;

  const { criticalCount, highCount, mediumCount, atRiskContacts } = churnData.data;
  const totalAtRisk = criticalCount + highCount + mediumCount;

  if (totalAtRisk === 0) return null;

  const totalForBar = totalAtRisk || 1;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Riesgo de Churn</h3>
        <span className="text-xs text-gray-400">{totalAtRisk} contactos en riesgo</span>
      </div>

      {/* Risk distribution bar */}
      <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-gray-800">
        {criticalCount > 0 && (
          <div
            className="bg-red-500 transition-all"
            style={{ width: `${(criticalCount / totalForBar) * 100}%` }}
            title={`Critico: ${criticalCount}`}
          />
        )}
        {highCount > 0 && (
          <div
            className="bg-orange-500 transition-all"
            style={{ width: `${(highCount / totalForBar) * 100}%` }}
            title={`Alto: ${highCount}`}
          />
        )}
        {mediumCount > 0 && (
          <div
            className="bg-yellow-500 transition-all"
            style={{ width: `${(mediumCount / totalForBar) * 100}%` }}
            title={`Medio: ${mediumCount}`}
          />
        )}
      </div>

      {/* Legend */}
      <div className="mb-4 flex gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
          <span className="text-gray-400">Critico ({criticalCount})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
          <span className="text-gray-400">Alto ({highCount})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
          <span className="text-gray-400">Medio ({mediumCount})</span>
        </div>
      </div>

      {/* At-risk contacts table */}
      {atRiskContacts.length > 0 && (
        <div className="space-y-2">
          {atRiskContacts.slice(0, 10).map((contact) => (
            <a
              key={contact.id}
              href={`/conversations?contact=${contact.id}`}
              className="flex items-center justify-between rounded-lg bg-gray-800/50 px-3 py-2.5 transition-colors hover:bg-gray-800"
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    contact.riskLevel === "critical" ? "bg-red-500" : "bg-orange-500"
                  )}
                />
                <div>
                  <p className="text-sm text-white">
                    {contact.displayName ?? contact.username}
                  </p>
                  <p className="text-xs text-gray-500">
                    {STAGE_LABELS[contact.funnelStage] ?? contact.funnelStage} · {contact.daysSinceInteraction}d inactivo
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p
                  className={cn(
                    "text-sm font-semibold",
                    contact.churnScore >= 75 ? "text-red-400" : "text-orange-400"
                  )}
                >
                  {contact.churnScore}%
                </p>
                <p className="max-w-[200px] truncate text-[10px] text-gray-500">
                  {contact.suggestedAction}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
