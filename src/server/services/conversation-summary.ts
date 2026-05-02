import { type AIConfig, callAIProvider, stripThinkingBlocks } from "./ai";
import { getLanguageInstruction } from "./language-utils";

// ============================================================
// Types
// ============================================================

export type ConversationSummary = {
  summary: string;
  mainTopic: string;
  relationshipStatus: string;
  nextSteps: string[];
  tokensUsed: number;
};

export type SummaryInput = {
  platformType: string;
  contactUsername: string;
  funnelStage: string;
  messages: { role: "fan" | "creator"; content: string }[];
  language?: string;
};

// ============================================================
// Prompt
// ============================================================

const SUMMARY_SYSTEM_PROMPT = `Eres un asistente que resume conversaciones entre creadores de contenido y sus fans.
Responde SOLO con un JSON valido (sin markdown, sin explicaciones).

El JSON debe tener esta estructura:
{
  "summary": <string, resumen de 2-3 frases de la conversacion>,
  "mainTopic": <string, tema principal discutido>,
  "relationshipStatus": <string corto: "inicial", "en desarrollo", "solida", "en riesgo", "inactiva">,
  "nextSteps": <array de 1-3 strings con acciones recomendadas para el creador>
}

Responde UNICAMENTE con el JSON.`;

// ============================================================
// Parser
// ============================================================

function parseSummaryJSON(text: string): Omit<ConversationSummary, "tokensUsed"> | null {
  let cleaned = stripThinkingBlocks(text);
  cleaned = cleaned.replace(/```json\s*/gi, "").replace(/```\s*/gi, "");

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      summary: String(parsed.summary || "Sin resumen disponible"),
      mainTopic: String(parsed.mainTopic || "General"),
      relationshipStatus: String(parsed.relationshipStatus || "inicial"),
      nextSteps: Array.isArray(parsed.nextSteps)
        ? parsed.nextSteps.map(String).slice(0, 3)
        : [],
    };
  } catch {
    return null;
  }
}

// ============================================================
// Main
// ============================================================

export async function summarizeConversation(
  config: AIConfig,
  input: SummaryInput
): Promise<ConversationSummary> {
  const context = [
    `Plataforma: ${input.platformType}`,
    `Usuario: @${input.contactUsername}`,
    `Etapa del funnel: ${input.funnelStage}`,
    `\nConversacion (${input.messages.length} mensajes):`,
    ...input.messages.slice(-30).map(
      (m) => `${m.role === "fan" ? "Fan" : "Creador"}: ${m.content}`
    ),
  ].join("\n");

  let systemPrompt = SUMMARY_SYSTEM_PROMPT;
  if (input.language) {
    systemPrompt += `\n\n${getLanguageInstruction(input.language)}`;
  }

  const result = await callAIProvider(
    config,
    systemPrompt,
    [{ role: "user", content: context }],
    512
  );

  const parsed = parseSummaryJSON(result.text);

  if (!parsed) {
    return {
      summary: "No se pudo generar el resumen.",
      mainTopic: "Desconocido",
      relationshipStatus: "inicial",
      nextSteps: [],
      tokensUsed: result.tokensUsed,
    };
  }

  return { ...parsed, tokensUsed: result.tokensUsed };
}
