import { callAIProvider, type AIConfig } from "./ai";
import { parseTolerantJSON } from "./ai-json-parser";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("message-classifier");

export type MessageCategory = "urgent" | "price_inquiry" | "spam" | "general";

export type ClassificationResult = {
  category: MessageCategory;
  confidence: number;
};

const KEYWORD_PATTERNS: { category: MessageCategory; patterns: RegExp[] }[] = [
  {
    category: "price_inquiry",
    patterns: [
      /\b(precio|costo|cuanto|cobras?|tarifas?|pagar|ppv|tip|propina|suscripci[oó]n|rate|pricing|how much|pay)\b/i,
    ],
  },
  {
    category: "urgent",
    // AI-10: quitado solo "ya" (muy común en coloquial: "ya veo", "ya lo hice").
    patterns: [
      /\b(urgente|ahora|necesito|rapido|emergencia|importante|asap|please now|right now|hurry)\b/i,
    ],
  },
  {
    category: "spam",
    // AI-10: quitados "free" (colisiona con "feel free to ask") y "link" (mención
    // normal). Las URLs múltiples se detectan aparte (ver classifyByKeywords).
    patterns: [
      /\b(gratis|sorteo|click|enlace|promo|descuento|gana|winner|lottery)\b/i,
    ],
  },
];

/**
 * Fast heuristic classification using keyword patterns.
 * Returns null if no strong match is found.
 */
function classifyByKeywords(message: string): ClassificationResult | null {
  for (const { category, patterns } of KEYWORD_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        return { category, confidence: 0.7 };
      }
    }
  }
  // AI-10: 2+ URLs (en cualquier posición, no solo consecutivas) → spam.
  if ((message.match(/https?:\/\/\S+/gi)?.length ?? 0) >= 2) {
    return { category: "spam", confidence: 0.7 };
  }
  return null;
}

/**
 * Classify a message using AI, with keyword fallback.
 */
export async function classifyMessage(
  config: AIConfig,
  message: string,
  platformType: string
): Promise<ClassificationResult> {
  // Try keywords first (fast, free)
  const keywordResult = classifyByKeywords(message);
  if (keywordResult) return keywordResult;

  // AI classification
  try {
    const systemPrompt = `Clasifica el siguiente mensaje de fan en UNA de estas categorias:
- urgent: El fan necesita respuesta inmediata o expresa urgencia
- price_inquiry: El fan pregunta sobre precios, pagos, contenido de pago o suscripciones
- spam: Mensaje basura, publicidad, enlaces sospechosos o contenido irrelevante
- general: Conversacion normal que no encaja en las otras categorias

Responde SOLO con un JSON: {"category": "...", "confidence": 0.0-1.0}
No incluyas nada mas. Plataforma: ${platformType}`;

    const result = await callAIProvider(
      config,
      systemPrompt,
      [{ role: "user", content: message }],
      100
    );

    const parsed = parseTolerantJSON<{ category?: string; confidence?: number }>(result.text);
    const category = parsed?.category as string | undefined;
    const confidence = Number(parsed?.confidence) || 0.5;

    if (category && ["urgent", "price_inquiry", "spam", "general"].includes(category)) {
      return { category: category as MessageCategory, confidence };
    }
    log.warn({ text: result.text.slice(0, 200) }, "Could not parse AI classification, falling back to general");
  } catch (err) {
    log.warn({ err }, "AI classification failed, falling back to general");
  }

  return { category: "general", confidence: 0.5 };
}
