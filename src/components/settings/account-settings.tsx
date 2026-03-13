"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { signOut } from "next-auth/react";

export function AccountSettings() {
  const profileQuery = trpc.account.getProfile.useQuery();
  const deleteAccount = trpc.account.deleteAccount.useMutation();

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");

  async function handleDelete() {
    setError("");
    try {
      await deleteAccount.mutateAsync({ password, confirmation });
      await signOut({ callbackUrl: "/login" });
    } catch (err: any) {
      setError(err.message ?? "Error al eliminar la cuenta");
    }
  }

  const profile = profileQuery.data;

  return (
    <div className="space-y-8">
      {/* Account Info */}
      <div>
        <h3 className="text-lg font-semibold text-white">Tu cuenta</h3>
        <p className="mt-1 text-sm text-gray-400">
          Informacion general de tu cuenta.
        </p>

        {profile && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800 px-4 py-3">
              <span className="text-sm text-gray-400">Nombre</span>
              <span className="text-sm text-white">{profile.name}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800 px-4 py-3">
              <span className="text-sm text-gray-400">Email</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-white">{profile.email}</span>
                {profile.emailVerified ? (
                  <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-[10px] font-medium text-green-400">
                    Verificado
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                    No verificado
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800 px-4 py-3">
              <span className="text-sm text-gray-400">Plan</span>
              <span className="text-sm capitalize text-white">
                {profile.subscriptionPlan}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800 px-4 py-3">
              <span className="text-sm text-gray-400">Registrado</span>
              <span className="text-sm text-white">
                {new Date(profile.createdAt).toLocaleDateString("es-ES")}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Danger Zone */}
      <div className="rounded-lg border border-red-500/30 p-6">
        <h3 className="text-lg font-semibold text-red-400">Zona peligrosa</h3>
        <p className="mt-1 text-sm text-gray-400">
          Eliminar tu cuenta borrara permanentemente todos tus datos: contactos,
          conversaciones, mensajes, configuracion de IA, templates y datos de
          facturacion.
        </p>
        <button
          onClick={() => setShowDeleteModal(true)}
          className="mt-4 rounded-lg border border-red-500/50 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
        >
          Eliminar mi cuenta
        </button>
      </div>

      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-red-500/50 bg-gray-900 p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-red-400">
              Eliminar cuenta permanentemente
            </h3>
            <p className="mt-2 text-sm text-gray-300">
              Esta accion no se puede deshacer. Todos tus datos seran eliminados
              permanentemente.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm text-gray-400">
                  Contrasena actual
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white focus:border-red-500 focus:outline-none"
                  placeholder="Tu contrasena"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-400">
                  Escribe <strong className="text-red-400">ELIMINAR</strong>{" "}
                  para confirmar
                </label>
                <input
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white focus:border-red-500 focus:outline-none"
                  placeholder="ELIMINAR"
                />
              </div>
            </div>

            {error && (
              <p className="mt-3 text-sm text-red-400">{error}</p>
            )}

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setPassword("");
                  setConfirmation("");
                  setError("");
                }}
                className="flex-1 rounded-lg border border-gray-600 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={
                  deleteAccount.isPending ||
                  !password ||
                  confirmation !== "ELIMINAR"
                }
                className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteAccount.isPending
                  ? "Eliminando..."
                  : "Eliminar permanentemente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
