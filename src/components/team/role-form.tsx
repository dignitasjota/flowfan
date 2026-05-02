"use client";

import { useState } from "react";
import {
  PERMISSION_CATEGORIES,
  PERMISSION_LABELS,
  type Permission,
} from "@/lib/permissions";

type RoleFormData = {
  name: string;
  description: string;
  permissions: string[];
  color: string;
};

const ROLE_COLORS = [
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#6b7280",
];

export function RoleForm({
  initialData,
  isSystem,
  onSubmit,
  onCancel,
}: {
  initialData?: Partial<RoleFormData>;
  isSystem?: boolean;
  onSubmit: (data: RoleFormData) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [permissions, setPermissions] = useState<string[]>(
    initialData?.permissions ?? []
  );
  const [color, setColor] = useState(initialData?.color ?? "#6b7280");

  const togglePermission = (perm: string) => {
    if (isSystem) return;
    setPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const toggleCategory = (categoryPerms: Permission[]) => {
    if (isSystem) return;
    const allSelected = categoryPerms.every((p) => permissions.includes(p));
    if (allSelected) {
      setPermissions((prev) => prev.filter((p) => !categoryPerms.includes(p as Permission)));
    } else {
      setPermissions((prev) => [
        ...prev,
        ...categoryPerms.filter((p) => !prev.includes(p)),
      ]);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">Nombre</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isSystem}
          className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white disabled:opacity-50"
          placeholder="Nombre del rol"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">Descripción</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
          placeholder="Descripción del rol"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Color</label>
        <div className="flex gap-2">
          {ROLE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`w-7 h-7 rounded-full border-2 ${
                color === c ? "border-white" : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Permisos</label>
        {isSystem && (
          <p className="text-xs text-gray-500 mb-2">
            Los permisos de roles del sistema no se pueden modificar.
          </p>
        )}
        <div className="space-y-3">
          {Object.entries(PERMISSION_CATEGORIES).map(([key, cat]) => {
            const allSelected = cat.permissions.every((p) =>
              permissions.includes(p)
            );
            const someSelected = cat.permissions.some((p) =>
              permissions.includes(p)
            );

            return (
              <div key={key} className="bg-gray-800/50 rounded-lg p-3">
                <label className="flex items-center gap-2 mb-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected && !allSelected;
                    }}
                    onChange={() => toggleCategory(cat.permissions)}
                    disabled={isSystem}
                    className="rounded border-gray-600"
                  />
                  <span className="text-sm font-medium text-gray-200">
                    {cat.label}
                  </span>
                </label>
                <div className="ml-6 grid grid-cols-2 gap-1">
                  {cat.permissions.map((perm) => (
                    <label
                      key={perm}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={permissions.includes(perm)}
                        onChange={() => togglePermission(perm)}
                        disabled={isSystem}
                        className="rounded border-gray-600"
                      />
                      <span className="text-xs text-gray-400">
                        {PERMISSION_LABELS[perm]}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-400 hover:text-white"
        >
          Cancelar
        </button>
        {!isSystem && (
          <button
            type="button"
            onClick={() =>
              onSubmit({ name, description, permissions, color })
            }
            disabled={!name.trim() || permissions.length === 0}
            className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-md disabled:opacity-50"
          >
            Guardar
          </button>
        )}
      </div>
    </div>
  );
}
