import { type AIConfig, callAIProvider, stripThinkingBlocks } from "./ai";

// ============================================================
// Types
// ============================================================

export type SentimentResult = {
  score: number; // -1 to 1
  label: "very_negative" | "negative" | "neutral" | "positive" | "very_positive";
  emotionalTone: string;
  topics: string[];
  purchaseIntent: number; // 0 to 1
  budgetMentions: string[];
  keyPhrases: string[];
  tokensUsed: number;
};

export type AnalysisInput = {
  message: string;
  conversationHistory?: { role: "fan" | "creator"; content: string }[];
  platformType?: string;
};

// ============================================================
// Prompt
// ============================================================

const ANALYSIS_SYSTEM_PROMPT = `Eres un analista de conversaciones especializado en creadores de contenido y sus fans.
Analiza el mensaje del fan y responde SOLO con un JSON válido (sin markdown, sin explicaciones).

El JSON debe tener esta estructura exacta:
{
  "score": <número entre -1 y 1, donde -1 es muy negativo y 1 es muy positivo>,
  "label": <"very_negative" | "negative" | "neutral" | "positive" | "very_positive">,
  "emotionalTone": <string describiendo el tono emocional en español, ej: "entusiasta", "frustrado", "curioso">,
  "topics": <array de strings con los temas principales mencionados, máximo 5>,
  "purchaseIntent": <número entre 0 y 1, donde 0 es sin intención y 1 es intención clara de compra>,
  "budgetMentions": <array de strings con menciones de dinero/precios/presupuesto>,
  "keyPhrases": <array de strings con frases clave del mensaje, máximo 5>
}

Considera el contexto de la conversación si se proporciona.
Responde ÚNICAMENTE con el JSON, sin texto adicional.`;

// ============================================================
// JSON Parser (robust)
// ============================================================

function parseAnalysisJSON(text: string): Omit<SentimentResult, "tokensUsed"> | null {
  // Strip thinking blocks first
  let cleaned = stripThinkingBlocks(text);

  // Remove markdown code fences
  cleaned = cleaned.replace(/```json\s*/gi, "").replace(/```\s*/gi, "");

  // Try to extract JSON object
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and clamp values
    return {
      score: Math.max(-1, Math.min(1, Number(parsed.score) || 0)),
      label: ["very_negative", "negative", "neutral", "positive", "very_positive"].includes(parsed.label)
        ? parsed.label
        : "neutral",
      emotionalTone: String(parsed.emotionalTone || "neutral"),
      topics: Array.isArray(parsed.topics) ? parsed.topics.map(String).slice(0, 5) : [],
      purchaseIntent: Math.max(0, Math.min(1, Number(parsed.purchaseIntent) || 0)),
      budgetMentions: Array.isArray(parsed.budgetMentions) ? parsed.budgetMentions.map(String) : [],
      keyPhrases: Array.isArray(parsed.keyPhrases) ? parsed.keyPhrases.map(String).slice(0, 5) : [],
    };
  } catch {
    return null;
  }
}

// ============================================================
// Main function
// ============================================================

export async function analyzeMessage(
  config: AIConfig,
  input: AnalysisInput
): Promise<SentimentResult> {
  const messages: { role: "user" | "assistant"; content: string }[] = [];

  // Add recent conversation context (last 5 messages)
  if (input.conversationHistory?.length) {
    const recent = input.conversationHistory.slice(-5);
    for (const msg of recent) {
      messages.push({
        role: msg.role === "fan" ? "user" : "assistant",
        content: msg.content,
      });
    }
  }

  // The message to analyze
  messages.push({
    role: "user",
    content: `Analiza este mensaje del fan: "${input.message}"`,
  });

  const result = await callAIProvider(config, ANALYSIS_SYSTEM_PROMPT, messages, 512);
  const parsed = parseAnalysisJSON(result.text);

  if (!parsed) {
    // Fallback: return neutral analysis if parsing fails
    return {
      score: 0,
      label: "neutral",
      emotionalTone: "indeterminado",
      topics: [],
      purchaseIntent: 0,
      budgetMentions: [],
      keyPhrases: [],
      tokensUsed: result.tokensUsed,
    };
  }

  return {
    ...parsed,
    tokensUsed: result.tokensUsed,
  };
}
