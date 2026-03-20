"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const roleBadgeStyles: Record<string, string> = {
  owner: "bg-amber-900/50 text-amber-400",
  manager: "bg-indigo-900/50 text-indigo-400",
  chatter: "bg-gray-700 text-gray-300",
};

const roleLabels: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  chatter: "Chatter",
};

export default function TeamPage() {
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"manager" | "chatter">("chatter");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [roleDropdown, setRoleDropdown] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const members = trpc.team.getMembers.useQuery(undefined, {
    retry: false,
  });
  const pendingInvites = trpc.team.getPendingInvites.useQuery(undefined, {
    retry: false,
    enabled: !members.isError,
  });

  const invite = trpc.team.invite.useMutation({
    onSuccess: () => {
      utils.team.getPendingInvites.invalidate();
      setInviteEmail("");
      setInviteRole("chatter");
      setShowInviteForm(false);
    },
  });

  const revokeInvite = trpc.team.revokeInvite.useMutation({
    onSuccess: () => utils.team.getPendingInvites.invalidate(),
  });

  const removeMember = trpc.team.removeMember.useMutation({
    onSuccess: () => {
      utils.team.getMembers.invalidate();
      setConfirmRemove(null);
    },
  });

  const updateRole = trpc.team.updateMemberRole.useMutation({
    onSuccess: () => {
      utils.team.getMembers.invalidate();
      setRoleDropdown(null);
    },
  });

  // Plan gate: FORBIDDEN means user needs to upgrade
  if (members.isError) {
    const errorMessage = members.error?.message ?? "";
    const isForbidden =
      members.error?.data?.code === "FORBIDDEN" ||
      errorMessage.includes("FORBIDDEN");

    if (isForbidden) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-8 text-center">
            <h2 className="mb-2 text-xl font-semibold text-white">
              Funcionalidad no disponible
            </h2>
            <p className="mb-4 text-gray-400">
              La gestion de equipo no esta incluida en tu plan actual.
              Actualiza tu suscripcion para invitar miembros a tu equipo.
            </p>
            <a
              href="/billing"
              className="inline-block rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
            >
              Ver planes
            </a>
          </div>
        </div>
      );
    }
  }

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    invite.mutate({ email: inviteEmail.trim(), role: inviteRole });
  };

  const copyInviteLink = (token: string, id: string) => {
    const link = `${window.location.origin}/invite/${token}`;
    navigator.clipboard.writeText(link);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const isExpired = (date: Date | string) => {
    return new Date(date) < new Date();
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
        <h2 className="text-lg font-semibold text-white">Equipo</h2>
        <button
          onClick={() => setShowInviteForm(!showInviteForm)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
        >
          {showInviteForm ? "Cancelar" : "Invitar miembro"}
        </button>
      </div>

      <div className="flex-1 space-y-8 px-6 py-6">
        {/* Invite Form */}
        {showInviteForm && (
          <form
            onSubmit={handleInvite}
            className="rounded-xl border border-gray-800 bg-gray-900 p-5"
          >
            <h3 className="mb-4 text-sm font-semibold text-white">
              Enviar invitacion
            </h3>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="email"
                placeholder="email@ejemplo.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <select
                value={inviteRole}
                onChange={(e) =>
                  setInviteRole(e.target.value as "manager" | "chatter")
                }
                className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="chatter">Chatter</option>
                <option value="manager">Manager</option>
              </select>
              <button
                type="submit"
                disabled={invite.isPending}
                className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors disabled:opacity-50"
              >
                {invite.isPending ? "Enviando..." : "Enviar"}
              </button>
            </div>
            {invite.isError && (
              <p className="mt-2 text-sm text-red-400">
                {invite.error.message}
              </p>
            )}
          </form>
        )}

        {/* Pending Invites */}
        {pendingInvites.data && pendingInvites.data.length > 0 && (
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
              Invitaciones pendientes
            </h3>
            <div className="space-y-3">
              {pendingInvites.data.map((inv) => (
                <div
                  key={inv.id}
                  className="flex flex-col gap-3 rounded-xl border border-gray-800 bg-gray-900 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-white">
                      {inv.email}
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-xs font-medium",
                          roleBadgeStyles[inv.role] ?? roleBadgeStyles.chatter
                        )}
                      >
                        {roleLabels[inv.role] ?? inv.role}
                      </span>
                      <span
                        className={cn(
                          "text-xs",
                          isExpired(inv.expiresAt)
                            ? "text-red-400"
                            : "text-gray-500"
                        )}
                      >
                        {isExpired(inv.expiresAt)
                          ? "Expirada"
                          : `Expira ${formatDate(inv.expiresAt)}`}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => copyInviteLink(inv.token, inv.id)}
                      className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
                    >
                      {copiedId === inv.id ? "Copiado!" : "Copiar enlace"}
                    </button>
                    <button
                      onClick={() => revokeInvite.mutate({ inviteId: inv.id })}
                      disabled={revokeInvite.isPending}
                      className="rounded-lg border border-red-900/50 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-50"
                    >
                      Revocar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active Members */}
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
            Miembros activos
          </h3>
          {members.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-xl border border-gray-800 bg-gray-900"
                />
              ))}
            </div>
          ) : members.data && members.data.length > 0 ? (
            <div className="space-y-3">
              {members.data.map((member) => (
                <div
                  key={member.id}
                  className="flex flex-col gap-3 rounded-xl border border-gray-800 bg-gray-900 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">
                        {member.userName ?? "Sin nombre"}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-xs font-medium",
                          roleBadgeStyles[member.role] ??
                            roleBadgeStyles.chatter
                        )}
                      >
                        {roleLabels[member.role] ?? member.role}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">
                      {member.userEmail}
                    </span>
                    <span className="text-xs text-gray-500">
                      Desde {formatDate(member.joinedAt)}
                    </span>
                  </div>

                  {member.role !== "owner" && (
                    <div className="relative flex gap-2">
                      {/* Role change dropdown */}
                      <div className="relative">
                        <button
                          onClick={() =>
                            setRoleDropdown(
                              roleDropdown === member.userId
                                ? null
                                : member.userId
                            )
                          }
                          className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
                        >
                          Cambiar rol
                        </button>
                        {roleDropdown === member.userId && (
                          <div className="absolute right-0 top-full z-10 mt-1 w-36 rounded-lg border border-gray-700 bg-gray-800 py-1 shadow-xl">
                            {(["manager", "chatter"] as const)
                              .filter((r) => r !== member.role)
                              .map((role) => (
                                <button
                                  key={role}
                                  onClick={() =>
                                    updateRole.mutate({
                                      userId: member.userId,
                                      role,
                                    })
                                  }
                                  className="block w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                                >
                                  {roleLabels[role]}
                                </button>
                              ))}
                          </div>
                        )}
                      </div>

                      {/* Remove button with confirmation */}
                      {confirmRemove === member.userId ? (
                        <div className="flex gap-1">
                          <button
                            onClick={() =>
                              removeMember.mutate({ userId: member.userId })
                            }
                            disabled={removeMember.isPending}
                            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 transition-colors disabled:opacity-50"
                          >
                            Confirmar
                          </button>
                          <button
                            onClick={() => setConfirmRemove(null)}
                            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 transition-colors"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmRemove(member.userId)}
                          className="rounded-lg border border-red-900/50 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-900/20 transition-colors"
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-8 text-center">
              <p className="text-sm text-gray-400">
                Aun no tienes miembros en tu equipo. Invita a alguien para
                comenzar.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
