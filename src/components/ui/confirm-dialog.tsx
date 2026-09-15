"use client";

import { Modal } from "./modal";
import { cn } from "@/lib/utils";

/**
 * Diálogo de confirmación accesible sobre `<Modal>` (FE-12) — reemplaza el
 * `window.confirm()` nativo usado en ~13 sitios para acciones destructivas.
 * `confirm()` rompe el tema oscuro, no es personalizable y bloquea el hilo de
 * JS; este componente da foco/Escape/backdrop consistentes con el resto de
 * modales de la app.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  pendingLabel,
  onConfirm,
  onCancel,
  isPending = false,
  isDanger = true,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Texto del botón de confirmar mientras `isPending`. Por defecto `"${confirmLabel}..."`. */
  pendingLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending?: boolean;
  /** `true` (default) = botón rojo, para acciones destructivas. */
  isDanger?: boolean;
}) {
  return (
    <Modal
      onClose={onCancel}
      labelledBy="confirm-dialog-title"
      className="mx-4 w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl"
    >
      <h3 id="confirm-dialog-title" className="text-base font-semibold text-white">
        {title}
      </h3>
      <div className="mt-2 text-sm text-gray-400">{message}</div>
      <div className="mt-5 flex justify-end gap-3">
        <button
          onClick={onCancel}
          disabled={isPending}
          className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          disabled={isPending}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50",
            isDanger ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"
          )}
        >
          {isPending ? (pendingLabel ?? `${confirmLabel}...`) : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
