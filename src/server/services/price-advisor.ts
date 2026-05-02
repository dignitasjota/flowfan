import { type AIConfig, callAIProvider, stripThinkingBlocks } from "./ai";
import type { BehavioralSignals } from "./scoring";
import { getLanguageInstruction } from "./language-utils";

// ============================================================
// Types
// ============================================================

export type PriceAdvice = {
  recommendedPrice: number;
  priceRange: { min: number; max: number };
  confidence: number; // 0-1
  timing: "now" | "wait" | "soon";
  timingReason: string;
  strategy: string;
  tokensUsed: number;
};

export type PriceAdviceInput = {
  platformType: string;
  funnelStage: string;
  paymentProbability: number;
  estimatedBudget: string;
  engagementLevel: number;
  sentimentTrend: number;
  topics: string[];
  recentMessages: { role: "fan" | "creator"; content: string }[];
  language?: string;
};

// ============================================================
// Prompt
// ============================================================

const PRICE_SYSTEM_PROMPT = `Eres un asesor de monetizacion para creadores de contenido.
Analiza el perfil del fan y sugiere una estrategia de precio.
Responde SOLO con un JSON valido (sin markdown, sin explicaciones).

El JSON debe tener esta estructura:
{
  "recommendedPrice": <numero en USD, precio sugerido>,
  "priceRange": { "min": <numero>, "max": <numero> },
  "confidence": <0 a 1, que tan seguro estas>,
  "timing": <"now" | "wait" | "soon">,
  "timingReason": <string corto explicando por que ahora/esperar>,
  "strategy": <string con la estrategia recomendada en 1-2 frases>
}

Consideraciones por plataforma:
- OnlyFans: precios de suscripcion ($5-50), tips, PPV ($3-100+)
- Instagram/Twitter: contenido exclusivo, shoutouts ($10-500)
- Telegram: grupos VIP ($5-30/mes)
- Tinder/Reddit/Snapchat: contenido personalizado ($10-200)

Responde UNICAMENTE con el JSON.`;

// ============================================================
// Parser
// ============================================================

function parsePriceJSON(text: string): Omit<PriceAdvice, "tokensUsed"> | null {
  let cleaned = stripThinkingBlocks(text);
  cleaned = cleaned.replace(/```json\s*/gi, "").replace(/```\s*/gi, "");

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      recommendedPrice: Math.max(0, Number(parsed.recommendedPrice) || 0),
      priceRange: {
        min: Math.max(0, Number(parsed.priceRange?.min) || 0),
        max: Math.max(0, Number(parsed.priceRange?.max) || 0),
      },
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      timing: ["now", "wait", "soon"].includes(parsed.timing) ? parsed.timing : "wait",
      timingReason: String(parsed.timingReason || "Sin datos suficientes"),
      strategy: String(parsed.strategy || "Necesita mas interaccion"),
    };
  } catch {
    return null;
  }
}

// ============================================================
// Main
// ============================================================

export async function getPriceAdvice(
  config: AIConfig,
  input: PriceAdviceInput
): Promise<PriceAdvice> {
  const contextParts = [
    `Plataforma: ${input.platformType}`,
    `Etapa del funnel: ${input.funnelStage}`,
    `Probabilidad de pago: ${input.paymentProbability}%`,
    `Presupuesto estimado: ${input.estimatedBudget}`,
    `Engagement: ${input.engagementLevel}/100`,
    `Tendencia de sentimiento: ${input.sentimentTrend > 0 ? "positiva" : input.sentimentTrend < 0 ? "negativa" : "estable"}`,
  ];

  if (input.topics.length > 0) {
    contextParts.push(`Temas de interes: ${input.topics.join(", ")}`);
  }

  const recentContext = input.recentMessages.length > 0
    ? `\n\nUltimos mensajes:\n${input.recentMessages.slice(-5).map((m) => `${m.role === "fan" ? "Fan" : "Creador"}: ${m.content}`).join("\n")}`
    : "";

  let systemPrompt = PRICE_SYSTEM_PROMPT;
  if (input.language) {
    systemPrompt += `\n\n${getLanguageInstruction(input.language)}`;
  }

  const result = await callAIProvider(
    config,
    systemPrompt,
    [{ role: "user", content: contextParts.join("\n") + recentContext }],
    512
  );

  const parsed = parsePriceJSON(result.text);

  if (!parsed) {
    return {
      recommendedPrice: 0,
      priceRange: { min: 0, max: 0 },
      confidence: 0,
      timing: "wait",
      timingReason: "No se pudo analizar",
      strategy: "Necesita mas datos para una recomendacion",
      tokensUsed: result.tokensUsed,
    };
  }

  return { ...parsed, tokensUsed: result.tokensUsed };
}
