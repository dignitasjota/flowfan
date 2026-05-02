"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { AuditLogTable } from "@/components/team/audit-log-table";
import { AuditLogFilters } from "@/components/team/audit-log-filters";

type FilterValues = {
  userId?: string;
  action?: string;
  entityType?: string;
  dateFrom?: string;
  dateTo?: string;
};

export default function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<FilterValues>({});

  const queryInput = {
    page,
    pageSize: 50,
    userId: filters.userId,
    action: filters.action,
    entityType: filters.entityType,
    dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
    dateTo: filters.dateTo ? new Date(filters.dateTo + "T23:59:59") : undefined,
  };

  const { data, isLoading } = trpc.auditLog.list.useQuery(queryInput);
  const { data: actionTypes } = trpc.auditLog.getActionTypes.useQuery();
  const { data: users } = trpc.auditLog.getActiveUsers.useQuery();

  const handleFilterChange = (newFilters: FilterValues) => {
    setFilters(newFilters);
    setPage(1);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-gray-800 px-6 py-4">
        <h2 className="text-lg font-semibold text-white">Registro de Actividad</h2>
        <p className="text-sm text-gray-400 mt-1">
          Historial de acciones realizadas por miembros del equipo
        </p>
      </div>

      <div className="flex-1 space-y-4 px-6 py-6">
        <AuditLogFilters
          values={filters}
          onChange={handleFilterChange}
          actionTypes={actionTypes ?? []}
          users={
            users?.map((u) => ({
              userId: u.userId,
              userName: u.userName,
            })) ?? []
          }
        />

        <AuditLogTable
          items={(data?.items ?? []) as Array<{
            id: string;
            userId: string | null;
            userName: string;
            action: string;
            entityType: string;
            entityId: string | null;
            details: unknown;
            createdAt: Date | string;
          }>}
          isLoading={isLoading}
        />

        {data && data.total > 50 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-sm text-gray-500">
              Mostrando {(page - 1) * 50 + 1}-
              {Math.min(page * 50, data.total)} de {data.total}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm border border-gray-700 rounded-md text-gray-400 hover:text-white disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!data.hasMore}
                className="px-3 py-1.5 text-sm border border-gray-700 rounded-md text-gray-400 hover:text-white disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
