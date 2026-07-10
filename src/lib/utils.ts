import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formatea una fecha para el value/min de un `<input type="datetime-local">`.
 * Usa componentes LOCALES (no UTC) porque el input interpreta el valor en la
 * zona horaria del navegador. `toISOString().slice(0,16)` daría hora UTC y
 * desalinearía el `min` (FE-11).
 */
export function formatDateTimeLocal(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
