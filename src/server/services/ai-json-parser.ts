import { stripThinkingBlocks } from "./ai";

/**
 * Extrae y parsea un objeto JSON de la respuesta cruda de un modelo de IA,
 * tolerando: bloques `<think>` sin cerrar (razonadores truncados, ver AI-4),
 * fences ` ```json ... ``` `, y texto extra antes/después del JSON. Devuelve
 * `null` si no hay nada parseable.
 *
 * Antes esta misma lógica (con dos variantes ligeramente distintas) estaba
 * duplicada en 8 servicios de IA (`price-advisor`, `conversation-summary`,
 * `negotiation-coach`, `contact-report`, `content-gap-analyzer`,
 * `message-classifier`, `blog-to-social`, `public-thread-coach`) — un fix
 * como el de `<think>` sin cerrar quedaba parcheado en unos sitios sí y en
 * otros no. Se estandariza aquí sobre la variante que prioriza el contenido
 * DENTRO del fence cuando existe (más precisa: evita confundirse con llaves
 * sueltas en prosa fuera del bloque JSON).
 */
export function parseTolerantJSON<T = unknown>(text: string): T | null {
  const cleaned = stripThinkingBlocks(text);

  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const searchText = (fenced ? fenced[1]! : cleaned).trim();

  const firstBrace = searchText.indexOf("{");
  const lastBrace = searchText.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) return null;

  try {
    return JSON.parse(searchText.slice(firstBrace, lastBrace + 1)) as T;
  } catch {
    return null;
  }
}
