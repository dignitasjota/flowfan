import { Redis, type RedisOptions } from "ioredis";

/**
 * ARCH-10: punto único para construir un cliente ioredis "normal" (comandos
 * sueltos, no BullMQ) a partir de `REDIS_URL`.
 *
 * Antes había ~6 instanciaciones de `new Redis(...)` casi idénticas
 * repartidas por el código (`server/redis.ts`, `rate-limit.ts`,
 * `scheduler-publisher.ts`, `redis-pubsub.ts` ×2, `health/route.ts`), cada
 * una repitiendo el mismo fallback a `redis://localhost:6379`.
 *
 * Ojo: esta factoría NO fuerza una única conexión física compartida ni una
 * única configuración de retries. `rate-limit.ts` y el cache de tokens de
 * Reddit en `scheduler-publisher.ts` quieren fallar rápido
 * (`maxRetriesPerRequest: 1`) para degradar con gracia si Redis va lento en
 * vez de colgar la request; BullMQ (ver `redis-connection.ts`, que sigue
 * siendo la factoría de opciones para las colas) y el publisher de
 * pub/sub necesitan `maxRetriesPerRequest: null` para no soltar comandos
 * bloqueantes. Forzar todo a una sola conexión/config rompería esas
 * propiedades deliberadas — lo que se centraliza aquí es el parseo de la
 * URL y el fallback, no el ciclo de vida de cada conexión.
 */
export function createRedisClient(options: RedisOptions = {}): Redis {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  return new Redis(url, options);
}

/**
 * Opciones para clientes "fail-fast": rate limiting, locks, caches con
 * fallback — no deben colgar la request si Redis va lento o cae.
 */
export const FAIL_FAST_REDIS_OPTIONS: RedisOptions = {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
};

/**
 * Opciones para clientes de larga vida (BullMQ-adyacentes, pub/sub): no
 * deben soltar comandos bloqueantes tras N reintentos.
 */
export const LONG_LIVED_REDIS_OPTIONS: RedisOptions = {
  maxRetriesPerRequest: null,
};
