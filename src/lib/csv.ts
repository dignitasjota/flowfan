/**
 * Serialización CSV segura.
 *
 * Además de escapar comillas, neutraliza la inyección de fórmulas: una celda
 * que empieza por = + - @ (o tab/CR) la interpretan Excel/Sheets como fórmula.
 * Los nombres de fans y descripciones son texto de terceros, así que se
 * prefija una comilla simple.
 */
export function toCsvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  return [
    headers.map(toCsvCell).join(","),
    ...rows.map((r) => headers.map((h) => toCsvCell(r[h])).join(",")),
  ].join("\n");
}
