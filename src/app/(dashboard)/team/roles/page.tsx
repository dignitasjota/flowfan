"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { RoleForm } from "@/components/team/role-form";
import { PermissionBadge } from "@/components/team/permission-badge";

export default function RolesPage() {
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const { data: roles, refetch } = trpc.team.getCustomRoles.useQuery();
  const createRole = trpc.team.createCustomRole.useMutation({
    onSuccess: () => {
      refetch();
      setIsCreating(false);
    },
  });
  const updateRole = trpc.team.updateCustomRole.useMutation({
    onSuccess: () => {
      refetch();
      setEditingRoleId(null);
    },
  });
  const deleteRole = trpc.team.deleteCustomRole.useMutation({
    onSuccess: () => refetch(),
  });

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Gestión de Roles</h1>
          <p className="text-sm text-gray-400 mt-1">
            Define roles personalizados con permisos granulares para tu equipo
          </p>
        </div>
        <button
          onClick={() => {
            setIsCreating(true);
            setEditingRoleId(null);
          }}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-md"
        >
          Nuevo rol
        </button>
      </div>

      {isCreating && (
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
          <h3 className="text-sm font-medium text-white mb-3">Crear nuevo rol</h3>
          <RoleForm
            onSubmit={(data) => createRole.mutate(data)}
            onCancel={() => setIsCreating(false)}
          />
        </div>
      )}

      <div className="space-y-3">
        {roles?.map((role) => (
          <div
            key={role.id}
            className="bg-gray-900 border border-gray-700 rounded-lg p-4"
          >
            {editingRoleId === role.id ? (
              <RoleForm
                initialData={{
                  name: role.name,
                  description: role.description ?? "",
                  permissions: role.permissions as string[],
                  color: role.color ?? "#6b7280",
                }}
                isSystem={role.isSystem}
                onSubmit={(data) =>
                  updateRole.mutate({ roleId: role.id, ...data })
                }
                onCancel={() => setEditingRoleId(null)}
              />
            ) : (
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <PermissionBadge
                      name={role.name}
                      color={role.color}
                    />
                    {role.isSystem && (
                      <span className="text-xs text-gray-500">Sistema</span>
                    )}
                  </div>
                  {role.description && (
                    <p className="text-xs text-gray-400">{role.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {(role.permissions as string[]).slice(0, 5).map((p) => (
                      <span
                        key={p}
                        className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded"
                      >
                        {p}
                      </span>
                    ))}
                    {(role.permissions as string[]).length > 5 && (
                      <span className="text-xs text-gray-500">
                        +{(role.permissions as string[]).length - 5} más
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditingRoleId(role.id);
                      setIsCreating(false);
                    }}
                    className="text-xs text-gray-400 hover:text-white"
                  >
                    Editar
                  </button>
                  {!role.isSystem && (
                    <button
                      onClick={() => {
                        if (confirm("¿Eliminar este rol?")) {
                          deleteRole.mutate({ roleId: role.id });
                        }
                      }}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
