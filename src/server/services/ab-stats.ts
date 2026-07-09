/**
 * Estadística compartida para A/B testing (conversation modes y mensajes).
 *
 * `twoProportionConfidence` hace un z-test de dos proporciones y devuelve la
 * confianza (1 - p_value, dos colas) de que la diferencia entre las dos tasas
 * es real. Requiere un mínimo de muestra por grupo para no dar falsos positivos.
 */

/** Aproximación de la CDF normal estándar (Abramowitz & Stegun 7.1.26). */
export function normalCDF(z: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y =
    1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Confianza (0-1) de que dos proporciones difieren, vía z-test agrupado.
 * Devuelve 0 si no hay muestra suficiente (< minSample por grupo) o si el
 * pooled es degenerado (0 o 1).
 */
export function twoProportionConfidence(
  nA: number,
  pA: number,
  nB: number,
  pB: number,
  minSample = 10
): number {
  if (nA < minSample || nB < minSample) return 0;

  const pooled = (pA * nA + pB * nB) / (nA + nB);
  if (pooled === 0 || pooled === 1) return 0;

  const se = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
  if (se === 0) return 0;

  const z = Math.abs(pA - pB) / se;
  const pValue = 2 * (1 - normalCDF(z));
  return Math.max(0, Math.min(1, 1 - pValue));
}
