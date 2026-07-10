"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * FE-12: overlay de diálogo accesible reutilizable.
 *
 * Antes cada modal era un `<div>` con `fixed inset-0` sin semántica: los lectores
 * de pantalla no lo anunciaban como diálogo, no había cierre con Escape, ni focus
 * trap, ni restauración del foco. Grave en confirmaciones destructivas (borrado)
 * porque el modal podía activarse sin percibirlo.
 *
 * Este wrapper aporta:
 * - `role="dialog"` + `aria-modal="true"` + `aria-label`/`aria-labelledby`.
 * - Cierre con `Escape` y clic en el backdrop.
 * - Focus trap básico (Tab cíclico) y foco inicial en el panel.
 * - Restauración del foco al elemento previo al cerrar.
 */
export function Modal({
  onClose,
  children,
  className,
  labelledBy,
  label,
  closeOnBackdrop = true,
}: {
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  labelledBy?: string;
  label?: string;
  closeOnBackdrop?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    // Foco inicial en el panel (o su primer control enfocable).
    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    (focusable ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && panel) {
        const items = Array.from(
          panel.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement as HTMLElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn("outline-none", className)}
      >
        {children}
      </div>
    </div>
  );
}
