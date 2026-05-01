import { callAIProvider, type AIConfig } from "./ai";
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
    patterns: [
      /\b(urgente|ahora|ya|necesito|rapido|emergencia|importante|asap|please now|right now|hurry)\b/i,
    ],
  },
  {
    category: "spam",
    patterns: [
      /\b(gratis|free|sorteo|click|enlace|link|promo|descuento|gana|winner|lottery)\b/i,
      /(https?:\/\/\S+){2,}/i, // Multiple URLs
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

    const parsed = JSON.parse(result.text);
    const category = parsed.category as string;
    const confidence = Number(parsed.confidence) || 0.5;

    if (["urgent", "price_inquiry", "spam", "general"].includes(category)) {
      return { category: category as MessageCategory, confidence };
    }
  } catch (err) {
    log.warn({ err }, "AI classification failed, falling back to general");
  }

  return { category: "general", confidence: 0.5 };
}
