/**
 * Magic-byte sniffing para validar que el contenido del buffer corresponde
 * con el MIME que declaró el cliente. Trust pero verify — el header
 * `Content-Type` lo manda el browser y puede ser inventado.
 *
 * Cubrimos solo los MIMEs que `/api/media/upload` acepta. Si la lista crece
 * (HEIC, AVIF, AV1, etc.) basta con extender `SIGNATURES`.
 */

type Signature = {
  /** Mime declarado que esta firma autoriza. */
  mime: string;
  /** Posición desde donde empieza a comparar `bytes`. */
  offset: number;
  /** Patrón de bytes. `null` = wildcard (cualquier byte). */
  bytes: (number | null)[];
};

const SIGNATURES: Signature[] = [
  { mime: "image/jpeg", offset: 0, bytes: [0xff, 0xd8, 0xff] },
  {
    mime: "image/png",
    offset: 0,
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  // GIF87a / GIF89a
  {
    mime: "image/gif",
    offset: 0,
    bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
  },
  {
    mime: "image/gif",
    offset: 0,
    bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  },
  // RIFF....WEBP
  {
    mime: "image/webp",
    offset: 0,
    bytes: [
      0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50,
    ],
  },
  // MP4 / M4V / quicktime — todos comparten "ftyp" en bytes 4-7.
  // El brand (offset 8) los diferencia, pero a efectos de "esto es vídeo
  // contenedor MP4-like" la firma ftyp es suficiente.
  {
    mime: "video/mp4",
    offset: 4,
    bytes: [0x66, 0x74, 0x79, 0x70],
  },
  {
    mime: "video/quicktime",
    offset: 4,
    bytes: [0x66, 0x74, 0x79, 0x70],
  },
  // WebM / Matroska — EBML header
  {
    mime: "video/webm",
    offset: 0,
    bytes: [0x1a, 0x45, 0xdf, 0xa3],
  },
];

function matches(buffer: Buffer, sig: Signature): boolean {
  if (buffer.length < sig.offset + sig.bytes.length) return false;
  for (let i = 0; i < sig.bytes.length; i++) {
    const expected = sig.bytes[i];
    if (expected === null) continue;
    if (buffer[sig.offset + i] !== expected) return false;
  }
  return true;
}

/**
 * Devuelve `true` si los primeros bytes del buffer coinciden con alguna
 * firma registrada para `declaredMime`. Si el MIME no tiene firmas
 * registradas devuelve `true` (no podemos verificar — degradación segura).
 */
export function bufferMatchesMime(buffer: Buffer, declaredMime: string): boolean {
  const candidates = SIGNATURES.filter((s) => s.mime === declaredMime);
  if (candidates.length === 0) return true; // no signature on file → don't block
  return candidates.some((sig) => matches(buffer, sig));
}
