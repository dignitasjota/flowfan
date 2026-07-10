/**
 * Extrae la IP del cliente para rate limiting (SEC-4).
 *
 * ⚠️ El valor de `X-Forwarded-For` es tan fiable como el proxy que lo pone.
 * Este helper toma el primer valor de XFF, que es la IP real del cliente
 * **solo si el proxy de confianza SOBRESCRIBE la cabecera** en vez de anexar a
 * la que llega. En producción, Nginx Proxy Manager debe estar configurado con
 *   proxy_set_header X-Forwarded-For $remote_addr;
 * (o equivalente) para no confiar en el XFF entrante — de lo contrario un
 * atacante puede rotar IPs falsas y evadir el rate limit de fuerza bruta.
 *
 * `TRUSTED_PROXY_HOPS` (env, opcional): número de proxies de confianza que
 * ANEXAN al XFF. Si se define > 0, se cuenta desde la derecha (la IP que puso el
 * proxy más externo de confianza) en vez de tomar el primer valor.
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);
      if (hops > 0 && parts.length >= hops) {
        return parts[parts.length - hops];
      }
      return parts[0];
    }
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
