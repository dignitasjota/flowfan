"use client";

import { useState } from "react";
import { getActionLabel, getEntityTypeLabel } from "@/lib/audit-actions";

type AuditEntry = {
  id: string;
  userId: string | null;
  userName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  details: unknown;
  createdAt: Date | string;
};

export function AuditLogTable({
  items,
  isLoading,
}: {
  items: AuditEntry[];
  isLoading: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleString("es-ES", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-lg bg-gray-800"
          />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
        <p className="text-sm text-gray-400">No hay registros de actividad.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-xs text-gray-500 uppercase">
            <th className="px-4 py-3">Fecha</th>
            <th className="px-4 py-3">Usuario</th>
            <th className="px-4 py-3">Acción</th>
            <th className="px-4 py-3">Tipo</th>
            <th className="px-4 py-3">Detalles</th>
          </tr>
        </thead>
        <tbody>
          {items.map((entry) => (
            <>
              <tr
                key={entry.id}
                className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer"
                onClick={() =>
                  setExpandedId(expandedId === entry.id ? null : entry.id)
                }
              >
                <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                  {formatDate(entry.createdAt)}
                </td>
                <td className="px-4 py-3 text-white">{entry.userName}</td>
                <td className="px-4 py-3 text-gray-300">
                  {getActionLabel(entry.action)}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
                    {getEntityTypeLabel(entry.entityType)}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {expandedId === entry.id ? "▼" : "▶"}
                </td>
              </tr>
              {expandedId === entry.id && (
                <tr key={`${entry.id}-details`}>
                  <td colSpan={5} className="px-4 py-3 bg-gray-800/20">
                    <div className="space-y-1 text-xs">
                      {entry.entityId && (
                        <p className="text-gray-400">
                          <span className="text-gray-500">ID:</span>{" "}
                          {entry.entityId}
                        </p>
                      )}
                      <pre className="text-gray-400 whitespace-pre-wrap overflow-auto max-h-40">
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
