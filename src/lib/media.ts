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

/**
 * Lee la duración (en segundos) de un vídeo accesible por URL. Funciona
 * solo en el browser — crea un `<video>` oculto, espera a `loadedmetadata`
 * y devuelve `video.duration`.
 *
 * Resuelve con `null` si el archivo no se puede leer (CORS, formato
 * inválido, timeout) — el caller decide si bloquear o continuar.
 */
export async function getVideoDuration(
  url: string,
  timeoutMs = 15_000
): Promise<number | null> {
  if (typeof document === "undefined") return null;
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    let done = false;
    const cleanup = () => {
      video.src = "";
      video.remove();
    };
    const finish = (value: number | null) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), timeoutMs);
    video.addEventListener("loadedmetadata", () => {
      clearTimeout(timeout);
      finish(Number.isFinite(video.duration) ? video.duration : null);
    });
    video.addEventListener("error", () => {
      clearTimeout(timeout);
      finish(null);
    });
    video.src = url;
  });
}
