/**
 * Marcadores de resaltado para los snippets de búsqueda (`ts_headline`).
 *
 * Se usan caracteres de control en vez de `<mark>` porque el contenido del
 * mensaje lo escribe un tercero (el fan) y no está escapado: renderizar el
 * snippet como HTML permitía XSS almacenado. El cliente parte el texto por
 * estos marcadores y pinta cada trozo como texto plano.
 */
export const HIGHLIGHT_START = "\u0002";
export const HIGHLIGHT_END = "\u0003";

export type HighlightSegment = { text: string; highlighted: boolean };

export function splitHighlightedSnippet(snippet: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let rest = snippet;
  while (rest.length > 0) {
    const start = rest.indexOf(HIGHLIGHT_START);
    if (start === -1) {
      segments.push({ text: rest, highlighted: false });
      break;
    }
    if (start > 0) segments.push({ text: rest.slice(0, start), highlighted: false });
    const end = rest.indexOf(HIGHLIGHT_END, start + 1);
    if (end === -1) {
      segments.push({ text: rest.slice(start + 1), highlighted: true });
      break;
    }
    segments.push({ text: rest.slice(start + 1, end), highlighted: true });
    rest = rest.slice(end + 1);
  }
  return segments.filter((s) => s.text.length > 0);
}
