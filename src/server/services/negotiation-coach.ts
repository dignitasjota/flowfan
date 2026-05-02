import { type AIConfig, callAIProvider, stripThinkingBlocks } from "./ai";
import { getLanguageInstruction } from "./language-utils";

// ============================================================
// Types
// ============================================================

export type CoachingType = "negotiation" | "retention" | "upsell";

export type CoachingTactic = {
  name: string;
  description: string;
  example: string;
  riskLevel: "low" | "medium" | "high";
};

export type CoachingResult = {
  situationAssessment: string;
  fanProfile: string;
  currentLeverage: string;
  risks: string[];
  tactics: CoachingTactic[];
  suggestedNextMove: string;
  avoidList: string[];
  tokensUsed: number;
};

export type CoachingInput = {
  coachingType: CoachingType;
  platformType: string;
  funnelStage: string;
  engagementLevel: number;
  paymentProbability: number;
  conversationHistory: { role: "fan" | "creator"; content: string }[];
  language?: string;
};

// ============================================================
// Prompts per coaching type
// ============================================================

const COACHING_PROMPTS: Record<CoachingType, string> = {
  negotiation: `Eres un coach experto en negociacion para creadores de contenido.
Analiza la conversacion y proporciona coaching estrategico sobre:
- Señales de compra y disposicion a pagar del fan
- Tecnicas de framing de valor y exclusividad
- Momento optimo para presentar una oferta
- Como manejar objeciones de precio`,

  retention: `Eres un coach experto en retencion de fans para creadores de contenido.
Analiza la conversacion y proporciona coaching estrategico sobre:
- Señales de desinteres o riesgo de abandono
- Tecnicas de re-engagement y reconexion emocional
- Como construir lealtad a largo plazo
- Estrategias para recuperar fans que se estan alejando`,

  upsell: `Eres un coach experto en upselling para creadores de contenido.
Analiza la conversacion y proporciona coaching estrategico sobre:
- Oportunidades de mover al fan a tiers superiores
- Como introducir contenido premium sin parecer agresivo
- Tecnicas de escasez y exclusividad
- Progresion natural hacia experiencias premium`,
};

const COACHING_FORMAT = `
Responde SOLO con un JSON valido (sin markdown, sin explicaciones):
{
  "situationAssessment": <string, analisis de 2-3 frases de la situacion actual>,
  "fanProfile": <string, perfil psicologico breve del fan basado en su comportamiento>,
  "currentLeverage": <string, puntos de apalancamiento que tiene el creador>,
  "risks": <array de strings, maximo 3 riesgos a evitar>,
  "tactics": [
    {
      "name": <string, nombre de la tactica>,
      "description": <string, explicacion de como aplicarla>,
      "example": <string, ejemplo concreto de frase o accion>,
      "riskLevel": <"low" | "medium" | "high">
    }
  ],
  "suggestedNextMove": <string, la mejor accion inmediata a tomar>,
  "avoidList": <array de strings, cosas que NO debe hacer/decir el creador>
}

Genera entre 3 y 5 tacticas ordenadas de menor a mayor riesgo.
Responde UNICAMENTE con el JSON.`;

// ============================================================
// Parser
// ============================================================

function parseCoachingJSON(text: string): Omit<CoachingResult, "tokensUsed"> | null {
  let cleaned = stripThinkingBlocks(text);
  cleaned = cleaned.replace(/```json\s*/gi, "").replace(/```\s*/gi, "");

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    const tactics: CoachingTactic[] = Array.isArray(parsed.tactics)
      ? parsed.tactics.slice(0, 5).map((t: any) => ({
          name: String(t.name || ""),
          description: String(t.description || ""),
          example: String(t.example || ""),
          riskLevel: ["low", "medium", "high"].includes(t.riskLevel)
            ? t.riskLevel
            : "medium",
        }))
      : [];

    return {
      situationAssessment: String(parsed.situationAssessment || "Sin datos suficientes"),
      fanProfile: String(parsed.fanProfile || "Perfil no determinado"),
      currentLeverage: String(parsed.currentLeverage || "Sin apalancamiento claro"),
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(String).slice(0, 3) : [],
      tactics,
      suggestedNextMove: String(parsed.suggestedNextMove || "Continuar observando"),
      avoidList: Array.isArray(parsed.avoidList) ? parsed.avoidList.map(String).slice(0, 5) : [],
    };
  } catch {
    return null;
  }
}

// ============================================================
// Main
// ============================================================

export async function generateCoaching(
  config: AIConfig,
  input: CoachingInput
): Promise<CoachingResult> {
  const basePrompt = COACHING_PROMPTS[input.coachingType];

  let systemPrompt = `${basePrompt}\n${COACHING_FORMAT}`;

  if (input.language) {
    systemPrompt += `\n\n${getLanguageInstruction(input.language)}`;
  }

  const contextParts = [
    `Plataforma: ${input.platformType}`,
    `Etapa del funnel: ${input.funnelStage}`,
    `Engagement: ${input.engagementLevel}/100`,
    `Probabilidad de pago: ${input.paymentProbability}%`,
    `\nConversacion reciente:`,
    ...input.conversationHistory.slice(-30).map(
      (m) => `${m.role === "fan" ? "Fan" : "Creador"}: ${m.content}`
    ),
  ];

  const messages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: contextParts.join("\n") },
  ];

  const result = await callAIProvider(config, systemPrompt, messages, 1500);
  const parsed = parseCoachingJSON(result.text);

  if (!parsed) {
    return {
      situationAssessment: "No se pudo generar el analisis.",
      fanProfile: "No disponible",
      currentLeverage: "No disponible",
      risks: [],
      tactics: [],
      suggestedNextMove: "Continuar la conversacion naturalmente",
      avoidList: [],
      tokensUsed: result.tokensUsed,
    };
  }

  return { ...parsed, tokensUsed: result.tokensUsed };
}
