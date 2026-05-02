"use client";

import { getActionLabel, getEntityTypeLabel, AUDIT_ACTION_LABELS } from "@/lib/audit-actions";

type FilterValues = {
  userId?: string;
  action?: string;
  entityType?: string;
  dateFrom?: string;
  dateTo?: string;
};

type UserOption = {
  userId: string | null;
  userName: string;
};

export function AuditLogFilters({
  values,
  onChange,
  actionTypes,
  users,
}: {
  values: FilterValues;
  onChange: (values: FilterValues) => void;
  actionTypes: string[];
  users: UserOption[];
}) {
  const entityTypes = [
    ...new Set(actionTypes.map((a) => a.split(".")[0]).filter(Boolean)),
  ];

  return (
    <div className="flex flex-wrap gap-3">
      <select
        value={values.userId ?? ""}
        onChange={(e) =>
          onChange({ ...values, userId: e.target.value || undefined })
        }
        className="rounded-md bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-white"
      >
        <option value="">Todos los usuarios</option>
        {users.map((u) => (
          <option key={u.userId ?? "null"} value={u.userId ?? ""}>
            {u.userName}
          </option>
        ))}
      </select>

      <select
        value={values.action ?? ""}
        onChange={(e) =>
          onChange({ ...values, action: e.target.value || undefined })
        }
        className="rounded-md bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-white"
      >
        <option value="">Todas las acciones</option>
        {actionTypes.map((a) => (
          <option key={a} value={a}>
            {getActionLabel(a)}
          </option>
        ))}
      </select>

      <select
        value={values.entityType ?? ""}
        onChange={(e) =>
          onChange({ ...values, entityType: e.target.value || undefined })
        }
        className="rounded-md bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-white"
      >
        <option value="">Todos los tipos</option>
        {entityTypes.map((t) => (
          <option key={t} value={t}>
            {getEntityTypeLabel(t)}
          </option>
        ))}
      </select>

      <input
        type="date"
        value={values.dateFrom ?? ""}
        onChange={(e) =>
          onChange({ ...values, dateFrom: e.target.value || undefined })
        }
        className="rounded-md bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-white"
        placeholder="Desde"
      />

      <input
        type="date"
        value={values.dateTo ?? ""}
        onChange={(e) =>
          onChange({ ...values, dateTo: e.target.value || undefined })
        }
        className="rounded-md bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-white"
        placeholder="Hasta"
      />

      {(values.userId || values.action || values.entityType || values.dateFrom || values.dateTo) && (
        <button
          onClick={() => onChange({})}
          className="text-xs text-gray-400 hover:text-white px-2"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
