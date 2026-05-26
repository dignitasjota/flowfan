const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm)(\?|#|$)/i;

/**
 * Heurística por extensión para decidir si una URL apunta a un vídeo.
 * Usado en el preview de `MediaUploader` (img vs video). No fetchea ni
 * adivina más allá de la extensión — suficiente para nuestros propios
 * uploads (que conservan extensión) y URLs pegadas razonables.
 */
export function isVideoUrl(url: string): boolean {
  return VIDEO_EXT_RE.test(url);
}
