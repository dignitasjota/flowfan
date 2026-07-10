import { lookup } from "dns/promises";

/**
 * Protección anti-SSRF para URLs de destino controladas por el usuario
 * (webhooks salientes, extracción de blogs, etc.).
 *
 * Bloquea esquemas no http(s) y destinos que resuelven a IPs privadas /
 * loopback / link-local / metadata cloud, para que un tenant no pueda usar un
 * webhook para alcanzar servicios internos del VPS o el endpoint de metadatos.
 */

/** ¿La IP (v4 o v6) está en un rango privado/no enrutable/peligroso? */
export function isPrivateIp(ip: string): boolean {
  // Normaliza IPv4 mapeada en IPv6 (::ffff:127.0.0.1)
  const v4mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const addr = v4mapped ? v4mapped[1] : ip;

  if (addr.includes(".")) {
    const parts = addr.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return true; // formato inesperado → tratar como inseguro
    }
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // multicast / reservado
    return false;
  }

  // IPv6
  const lower = addr.toLowerCase();
  if (lower === "::" || lower === "::1") return true; // unspecified / loopback
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local fc00::/7
  if (lower.startsWith("ff")) return true; // multicast
  return false;
}

/**
 * Valida que `rawUrl` es http(s) y que **todas** las IPs a las que resuelve son
 * públicas. Lanza `Error` con un mensaje seguro si no. No sigue redirecciones
 * (eso lo controla el caller: pásale `redirect: "manual"` o valida cada salto).
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("URL inválida");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Solo se permiten URLs http(s)");
  }

  // url.hostname conserva los brackets de IPv6 ([::1]); quitarlos para validar.
  const host = url.hostname.replace(/^\[|\]$/g, "");

  // Si el host ya es una IP literal, valídala directamente.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) {
    if (isPrivateIp(host)) {
      throw new Error("El destino apunta a una IP no permitida");
    }
    return;
  }

  // Resolver DNS y comprobar cada resultado.
  let results: { address: string }[];
  try {
    results = await lookup(host, { all: true });
  } catch {
    throw new Error("No se pudo resolver el host del destino");
  }
  if (results.length === 0) {
    throw new Error("El host no resuelve a ninguna dirección");
  }
  for (const { address } of results) {
    if (isPrivateIp(address)) {
      throw new Error("El destino apunta a una IP no permitida");
    }
  }
}
