/**
 * WK-9: opciones de conexión Redis para BullMQ derivadas de la URL COMPLETA.
 *
 * Antes cada cola/worker construía `{ host, port }` a partir de la URL, lo que
 * descartaba password, usuario, TLS (`rediss://`) y número de DB. En producción
 * con auth o TLS, las colas conectaban sin credenciales y fallaban. Este helper
 * respeta la URL entera y es el único punto de conexión.
 */
export function getRedisConnectionOptions() {
  const raw = process.env.REDIS_URL ?? "redis://localhost:6379";
  const url = new URL(raw);
  const dbPath = url.pathname.replace(/^\//, "");
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: dbPath ? Number(dbPath) : undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
    // Requerido por BullMQ para blocking commands.
    maxRetriesPerRequest: null,
  };
}
