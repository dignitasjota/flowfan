import { and, eq } from "drizzle-orm";
import type { db as dbType } from "@/server/db";
import { teamMembers, customRoles } from "@/server/db/schema";
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  type Permission,
  type BaseRole,
} from "@/lib/permissions";

type Db = typeof dbType;

export async function resolveUserPermissions(
  db: Db,
  creatorId: string,
  userId: string
): Promise<Permission[]> {
  // If acting on own account (not in a team), full permissions
  if (creatorId === userId) {
    return [...ALL_PERMISSIONS];
  }

  const member = await db.query.teamMembers.findFirst({
    where: and(
      eq(teamMembers.creatorId, creatorId),
      eq(teamMembers.userId, userId),
      eq(teamMembers.isActive, true)
    ),
    with: {
      customRole: true,
    },
  });

  if (!member) {
    return [];
  }

  const baseRole = member.role as BaseRole;

  if (baseRole === "owner") {
    return [...ALL_PERMISSIONS];
  }

  // If custom role is assigned, use its permissions
  if (member.customRole && member.customRole.permissions.length > 0) {
    return (member.customRole.permissions as string[]).filter((p) =>
      (ALL_PERMISSIONS as readonly string[]).includes(p)
    ) as Permission[];
  }

  return DEFAULT_ROLE_PERMISSIONS[baseRole] ?? [];
}

export async function seedSystemRoles(db: Db, creatorId: string): Promise<void> {
  const existing = await db.query.customRoles.findFirst({
    where: and(
      eq(customRoles.creatorId, creatorId),
      eq(customRoles.isSystem, true)
    ),
  });

  if (existing) return;

  const systemRoles = [
    {
      creatorId,
      name: "Owner",
      description: "Acceso completo a todas las funciones",
      permissions: [...ALL_PERMISSIONS] as string[],
      color: "#f59e0b",
      isSystem: true,
    },
    {
      creatorId,
      name: "Manager",
      description: "Gestión de contactos, conversaciones y analytics",
      permissions: DEFAULT_ROLE_PERMISSIONS.manager as string[],
      color: "#6366f1",
      isSystem: true,
    },
    {
      creatorId,
      name: "Chatter",
      description: "Solo conversaciones asignadas",
      permissions: DEFAULT_ROLE_PERMISSIONS.chatter as string[],
      color: "#6b7280",
      isSystem: true,
    },
  ];

  await db.insert(customRoles).values(systemRoles);
}
