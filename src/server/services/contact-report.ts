import { type AIConfig, callAIProvider, stripThinkingBlocks } from "./ai";
import { getLanguageInstruction } from "./language-utils";

// ============================================================
// Types
// ============================================================

export type ContactReport = {
  overview: string;
  patterns: string[];
  interests: string[];
  funnelPrediction: {
    nextStage: string;
    probability: number;
    timeframe: string;
  };
  recommendations: string[];
  riskLevel: "low" | "medium" | "high";
  riskFactors: string[];
  tokensUsed: number;
};

export type ReportInput = {
  contactUsername: string;
  platformType: string;
  funnelStage: string;
  engagementLevel: number;
  paymentProbability: number;
  estimatedBudget: string;
  totalConversations: number;
  firstInteractionAt: string;
  topics: string[];
  sentimentAvg: number;
  sentimentTrend: number;
  messageCount: number;
  recentMessages: { role: "fan" | "creator"; content: string }[];
  language?: string;
};

// ============================================================
// Prompt
// ============================================================

const REPORT_SYSTEM_PROMPT = `Eres un analista de relaciones para creadores de contenido.
Genera un informe detallado sobre un contacto/fan basandote en sus datos.
Responde SOLO con un JSON valido (sin markdown, sin explicaciones).

El JSON debe tener esta estructura:
{
  "overview": <string, resumen de 3-4 frases sobre la relacion con este fan>,
  "patterns": <array de strings, patrones de comportamiento detectados, max 5>,
  "interests": <array de strings, intereses/temas que mas le importan, max 5>,
  "funnelPrediction": {
    "nextStage": <string, siguiente etapa probable del funnel>,
    "probability": <0-100, probabilidad de avanzar>,
    "timeframe": <string, en cuanto tiempo, ej: "1-2 semanas">
  },
  "recommendations": <array de strings, acciones concretas recomendadas para el creador, max 5>,
  "riskLevel": <"low" | "medium" | "high">,
  "riskFactors": <array de strings, factores de riesgo de perder este fan, max 3>
}

Responde UNICAMENTE con el JSON, todo en espanol.`;

// ============================================================
// Parser
// ============================================================

function parseReportJSON(text: string): Omit<ContactReport, "tokensUsed"> | null {
  let cleaned = stripThinkingBlocks(text);
  cleaned = cleaned.replace(/```json\s*/gi, "").replace(/```\s*/gi, "");

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      overview: String(parsed.overview || "Sin datos suficientes"),
      patterns: Array.isArray(parsed.patterns) ? parsed.patterns.map(String).slice(0, 5) : [],
      interests: Array.isArray(parsed.interests) ? parsed.interests.map(String).slice(0, 5) : [],
      funnelPrediction: {
        nextStage: String(parsed.funnelPrediction?.nextStage || "sin cambio"),
        probability: Math.max(0, Math.min(100, Number(parsed.funnelPrediction?.probability) || 0)),
        timeframe: String(parsed.funnelPrediction?.timeframe || "indeterminado"),
      },
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map(String).slice(0, 5) : [],
      riskLevel: ["low", "medium", "high"].includes(parsed.riskLevel) ? parsed.riskLevel : "medium",
      riskFactors: Array.isArray(parsed.riskFactors) ? parsed.riskFactors.map(String).slice(0, 3) : [],
    };
  } catch {
    return null;
  }
}

// ============================================================
// Main
// ============================================================

export async function generateContactReport(
  config: AIConfig,
  input: ReportInput
): Promise<ContactReport> {
  const contextParts = [
    `Contacto: @${input.contactUsername}`,
    `Plataforma: ${input.platformType}`,
    `Etapa del funnel: ${input.funnelStage}`,
    `Engagement: ${input.engagementLevel}/100`,
    `Probabilidad de pago: ${input.paymentProbability}%`,
    `Presupuesto estimado: ${input.estimatedBudget}`,
    `Conversaciones totales: ${input.totalConversations}`,
    `Primera interaccion: ${input.firstInteractionAt}`,
    `Total mensajes del fan: ${input.messageCount}`,
    `Sentimiento promedio: ${input.sentimentAvg.toFixed(2)} (-1 a 1)`,
    `Tendencia de sentimiento: ${input.sentimentTrend > 0 ? "mejorando" : input.sentimentTrend < 0 ? "empeorando" : "estable"}`,
  ];

  if (input.topics.length > 0) {
    contextParts.push(`Temas mas frecuentes: ${input.topics.join(", ")}`);
  }

  if (input.recentMessages.length > 0) {
    contextParts.push(`\nUltimos mensajes:`);
    for (const m of input.recentMessages.slice(-10)) {
      contextParts.push(`${m.role === "fan" ? "Fan" : "Creador"}: ${m.content}`);
    }
  }

  let systemPrompt = REPORT_SYSTEM_PROMPT;
  if (input.language) {
    systemPrompt += `\n\n${getLanguageInstruction(input.language)}`;
  }

  const result = await callAIProvider(
    config,
    systemPrompt,
    [{ role: "user", content: contextParts.join("\n") }],
    1024
  );

  const parsed = parseReportJSON(result.text);

  if (!parsed) {
    return {
      overview: "No se pudo generar el informe.",
      patterns: [],
      interests: [],
      funnelPrediction: { nextStage: "desconocido", probability: 0, timeframe: "indeterminado" },
      recommendations: [],
      riskLevel: "medium",
      riskFactors: [],
      tokensUsed: result.tokensUsed,
    };
  }

  return { ...parsed, tokensUsed: result.tokensUsed };
}
