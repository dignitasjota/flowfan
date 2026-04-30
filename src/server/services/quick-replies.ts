import { callAIProvider, type AIConfig } from "./ai";
import { createChildLogger } from "@/lib/logger";
import type { ClassificationResult } from "./message-classifier";

const log = createChildLogger("quick-replies");

type QuickReplyContext = {
  message: string;
  platformType: string;
  classification?: ClassificationResult;
  contactProfile?: {
    funnelStage: string;
    engagementLevel: number;
  };
  personality?: {
    tone?: string;
    style?: string;
    role?: string;
  };
};

/**
 * Generate 3 short quick reply options for a fan message.
 */
export async function generateQuickReplies(
  config: AIConfig,
  context: QuickReplyContext
): Promise<string[]> {
  try {
    const classificationHint = context.classification
      ? `\nEl mensaje fue clasificado como: ${context.classification.category}`
      : "";

    const profileHint = context.contactProfile
      ? `\nPerfil del contacto: funnel=${context.contactProfile.funnelStage}, engagement=${context.contactProfile.engagementLevel}/100`
      : "";

    const toneHint = context.personality?.tone
      ? `\nTono de respuesta: ${context.personality.tone}`
      : "";

    const systemPrompt = `Genera exactamente 3 respuestas cortas y diferentes para responder al mensaje de un fan.
Plataforma: ${context.platformType}${classificationHint}${profileHint}${toneHint}

Reglas:
- Cada respuesta debe ser de 1-2 oraciones maximo
- La primera debe ser casual/amigable
- La segunda debe ser mas profesional/directa
- La tercera debe ser concisa/rapida
- Separa cada respuesta con ---

Responde SOLO con las 3 respuestas separadas por ---`;

    const result = await callAIProvider(
      config,
      systemPrompt,
      [{ role: "user", content: context.message }],
      300
    );

    const replies = result.content
      .split("---")
      .map((r) => r.trim())
      .filter((r) => r.length > 0)
      .slice(0, 3);

    if (replies.length === 0) {
      return [];
    }

    return replies;
  } catch (err) {
    log.warn({ err }, "Quick reply generation failed");
    return [];
  }
}
