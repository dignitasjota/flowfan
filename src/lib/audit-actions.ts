export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "contact.created": "Creó un contacto",
  "contact.updated": "Actualizó un contacto",
  "contact.deleted": "Eliminó un contacto",
  "conversation.assigned": "Asignó una conversación",
  "conversation.unassigned": "Desasignó una conversación",
  "conversation.status_changed": "Cambió estado de conversación",
  "message.sent": "Envió un mensaje",
  "member.invited": "Invitó a un miembro",
  "member.joined": "Se unió al equipo",
  "member.removed": "Eliminó un miembro",
  "member.role_changed": "Cambió rol de miembro",
  "member.custom_role_assigned": "Asignó rol personalizado",
  "role.created": "Creó un rol",
  "role.updated": "Actualizó un rol",
  "role.deleted": "Eliminó un rol",
  "settings.updated": "Actualizó configuración",
};

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  contact: "Contacto",
  conversation: "Conversación",
  message: "Mensaje",
  team_member: "Miembro",
  role: "Rol",
  settings: "Configuración",
  invite: "Invitación",
};

export function getActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export function getEntityTypeLabel(entityType: string): string {
  return ENTITY_TYPE_LABELS[entityType] ?? entityType;
}
