"use client";

import type { PresenceStatus } from "@/server/services/presence";

const statusColors: Record<PresenceStatus, string> = {
  online: "bg-green-500",
  away: "bg-yellow-500",
  offline: "bg-gray-500",
};

export function OnlineIndicator({ status }: { status: PresenceStatus }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${statusColors[status]}`}
      title={status === "online" ? "En línea" : status === "away" ? "Ausente" : "Desconectado"}
    />
  );
}
