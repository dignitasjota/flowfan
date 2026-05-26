/**
 * Pequeño helper para llamadas de polling (status checks de IG / X / etc).
 *
 * Cuando el servidor remoto devuelve 5xx o la red falla, NO queremos cortar
 * la espera entera — esos fallos suelen ser transitorios y el siguiente
 * tick resolverá. Pero un 4xx (auth, recurso inexistente) sí es definitivo
 * y debe propagarse.
 *
 * `fetchWithRetry` reintenta hasta `maxAttempts` veces con backoff
 * exponencial sólo en errores transitorios. Devuelve el último `Response`
 * exitoso (2xx) o lanza si se agotan los intentos.
 */

export type RetryOptions = {
  maxAttempts?: number;
  /** Base del backoff exponencial en ms. Intento N espera baseDelayMs * 2^(N-1). */
  baseDelayMs?: number;
  /** Cap del backoff total entre intentos. */
  maxDelayMs?: number;
};

const DEFAULTS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 5_000,
};

export async function fetchWithRetry(
  input: string,
  init?: RequestInit,
  options: RetryOptions = {}
): Promise<Response> {
  const opts = { ...DEFAULTS, ...options };
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const res = await fetch(input, init);
      // 2xx → éxito; 4xx → error definitivo (no reintenta);
      // 5xx → transitorio, reintentar
      if (res.ok) return res;
      if (res.status >= 400 && res.status < 500) {
        return res; // el caller decide cómo tratar 4xx (probablemente surface)
      }
      // 5xx — lo tratamos como transitorio
      lastErr = new Error(
        `HTTP ${res.status} on ${input}`
      );
    } catch (err) {
      // Network errors, AbortError, etc — transitorio salvo abort explícito
      const e = err as Error;
      if (e.name === "AbortError") throw e;
      lastErr = e;
    }

    if (attempt < opts.maxAttempts) {
      const delay = Math.min(
        opts.baseDelayMs * 2 ** (attempt - 1),
        opts.maxDelayMs
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastErr ?? new Error("fetchWithRetry: exhausted attempts");
}
