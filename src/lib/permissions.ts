// Granular permission system for team roles

export const ALL_PERMISSIONS = [
  "contacts.create",
  "contacts.read",
  "contacts.update",
  "contacts.delete",
  "conversations.read_all",
  "conversations.read_assigned",
  "conversations.send_messages",
  "conversations.assign",
  "analytics.view",
  "settings.manage",
  "team.manage_members",
  "team.manage_roles",
  "sequences.manage",
  "api.manage_keys",
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export const PERMISSION_CATEGORIES: Record<string, { label: string; permissions: Permission[] }> = {
  contacts: {
    label: "Contactos",
    permissions: ["contacts.create", "contacts.read", "contacts.update", "contacts.delete"],
  },
  conversations: {
    label: "Conversaciones",
    permissions: [
      "conversations.read_all",
      "conversations.read_assigned",
      "conversations.send_messages",
      "conversations.assign",
    ],
  },
  analytics: {
    label: "Analytics",
    permissions: ["analytics.view"],
  },
  settings: {
    label: "Configuración",
    permissions: ["settings.manage"],
  },
  team: {
    label: "Equipo",
    permissions: ["team.manage_members", "team.manage_roles"],
  },
  sequences: {
    label: "Secuencias",
    permissions: ["sequences.manage"],
  },
  api: {
    label: "API",
    permissions: ["api.manage_keys"],
  },
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  "contacts.create": "Crear contactos",
  "contacts.read": "Ver contactos",
  "contacts.update": "Editar contactos",
  "contacts.delete": "Eliminar contactos",
  "conversations.read_all": "Ver todas las conversaciones",
  "conversations.read_assigned": "Ver conversaciones asignadas",
  "conversations.send_messages": "Enviar mensajes",
  "conversations.assign": "Asignar conversaciones",
  "analytics.view": "Ver analytics",
  "settings.manage": "Gestionar configuración",
  "team.manage_members": "Gestionar miembros",
  "team.manage_roles": "Gestionar roles",
  "sequences.manage": "Gestionar secuencias",
  "api.manage_keys": "Gestionar API keys",
};

export type BaseRole = "owner" | "manager" | "chatter";

export const DEFAULT_ROLE_PERMISSIONS: Record<BaseRole, Permission[]> = {
  owner: [...ALL_PERMISSIONS],
  manager: [
    "contacts.create",
    "contacts.read",
    "contacts.update",
    "conversations.read_all",
    "conversations.read_assigned",
    "conversations.send_messages",
    "conversations.assign",
    "analytics.view",
    "sequences.manage",
  ],
  chatter: [
    "contacts.read",
    "conversations.read_assigned",
    "conversations.send_messages",
  ],
};

export function hasPermission(userPermissions: string[], required: Permission): boolean {
  return userPermissions.includes(required);
}

export function hasAnyPermission(userPermissions: string[], required: Permission[]): boolean {
  return required.some((p) => userPermissions.includes(p));
}

export function getEffectivePermissions(
  baseRole: BaseRole,
  customRolePermissions?: string[] | null
): Permission[] {
  if (baseRole === "owner") {
    return [...ALL_PERMISSIONS];
  }

  if (customRolePermissions && customRolePermissions.length > 0) {
    return customRolePermissions.filter((p) =>
      (ALL_PERMISSIONS as readonly string[]).includes(p)
    ) as Permission[];
  }

  return DEFAULT_ROLE_PERMISSIONS[baseRole] ?? [];
}
