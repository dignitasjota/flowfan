import { type AIConfig, callAIProvider, stripThinkingBlocks } from "./ai";
import { getLanguageInstruction } from "./language-utils";

export type PublicCoachingTactic = {
  name: string;
  description: string;
  example: string;
  riskLevel: "low" | "medium" | "high";
};

export type PublicCoachingResult = {
  situationRead: string;
  audienceRisk: "low" | "medium" | "high";
  suggestedTone: string;
  tactics: PublicCoachingTactic[];
  whatToAvoid: string[];
  suggestedNextMove: string;
};

export type PublicCoachingInput = {
  platformType: string;
  postContext: {
    title: string | null;
    content: string | null;
    url: string | null;
  };
  thread: { author: string; content: string; role: "fan" | "creator" }[];
  focusComment: { author: string; content: string };
  language?: string;
};

function buildSystemPrompt(input: PublicCoachingInput): string {
  const parts: string[] = [];
  parts.push(`Eres un coach de comunicación pública para creators. Analizas un hilo de comentarios PÚBLICO y das recomendaciones para responder sin dañar la marca personal del creator. Lo que se publique lo verá toda la audiencia, no solo el comentarista.

REGLAS CRÍTICAS:
- Optimiza para reputación de marca + engagement público, NO para conversión privada.
- Considera que otros usuarios leerán la respuesta y pueden screenshotearla.
- Evita recomendar nada que invite a DM, mencione precios, o suene comercial en abierto.
- Si el comentario es hostil, evalúa si responder o ignorar es mejor.
- Si el comentario es genuino, recomienda cómo responder de forma cálida y memorable.

FORMATO OBLIGATORIO — devuelve SOLO un JSON válido sin texto adicional, fences, ni explicaciones:

{
  "situationRead": "Lectura del hilo y del comentario en 2-3 frases.",
  "audienceRisk": "low | medium | high — riesgo de que la respuesta dañe la marca pública si se hace mal",
  "suggestedTone": "Una palabra o frase corta del tono recomendado (ej: cálido y breve, asertivo sin defenderse, ignorar)",
  "tactics": [
    {
      "name": "Nombre de la táctica",
      "description": "Cómo aplicarla en 1-2 frases",
      "example": "Ejemplo concreto de respuesta que el creator puede usar (texto literal entre comillas)",
      "riskLevel": "low | medium | high"
    }
  ],
  "whatToAvoid": ["Cosa concreta a evitar 1", "Cosa concreta a evitar 2"],
  "suggestedNextMove": "La acción concreta y única que recomendarías ahora mismo"
}

REGLAS:
- Mínimo 3 tácticas, máximo 5.
- "whatToAvoid" entre 2 y 4 ítems.
- Ejemplos en tácticas: respuestas listas para copiar-pegar, no descripciones genéricas.
- Si la mejor opción es no responder, dilo claramente en suggestedNextMove.`);
  if (input.language) {
    parts.push(`\n${getLanguageInstruction(input.language)}`);
  }
  return parts.join("\n");
}

function buildUserMessage(input: PublicCoachingInput): string {
  const lines: string[] = [];
  lines.push(`PLATAFORMA: ${input.platformType}`);
  if (input.postContext.title) lines.push(`POST TÍTULO: ${input.postContext.title}`);
  if (input.postContext.content)
    lines.push(`POST CONTENIDO: ${input.postContext.content.slice(0, 1000)}`);
  if (input.postContext.url) lines.push(`POST URL: ${input.postContext.url}`);

  if (input.thread.length > 0) {
    lines.push(`\nHILO PREVIO:`);
    for (const c of input.thread.slice(-15)) {
      lines.push(`[${c.role === "creator" ? "creator" : c.author}] ${c.content}`);
    }
  }

  lines.push(`\nCOMENTARIO A RESPONDER:`);
  lines.push(`[${input.focusComment.author}] ${input.focusComment.content}`);

  return lines.join("\n");
}

function tryParseCoaching(text: string): PublicCoachingResult | null {
  const cleaned = stripThinkingBlocks(text);
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : cleaned).trim();
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) return null;
  const slice = raw.slice(firstBrace, lastBrace + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const tactics = Array.isArray(obj.tactics)
    ? (obj.tactics as Record<string, unknown>[])
        .filter(
          (t) =>
            typeof t.name === "string" &&
            typeof t.description === "string" &&
            typeof t.example === "string"
        )
        .map((t) => ({
          name: String(t.name),
          description: String(t.description),
          example: String(t.example),
          riskLevel: (["low", "medium", "high"].includes(String(t.riskLevel))
            ? t.riskLevel
            : "medium") as "low" | "medium" | "high",
        }))
        .slice(0, 5)
    : [];

  if (tactics.length === 0) return null;

  const audienceRisk = (
    ["low", "medium", "high"].includes(String(obj.audienceRisk))
      ? obj.audienceRisk
      : "medium"
  ) as "low" | "medium" | "high";

  const whatToAvoid = Array.isArray(obj.whatToAvoid)
    ? (obj.whatToAvoid.filter((x) => typeof x === "string") as string[]).slice(0, 6)
    : [];

  return {
    situationRead: typeof obj.situationRead === "string" ? obj.situationRead : "",
    audienceRisk,
    suggestedTone:
      typeof obj.suggestedTone === "string" ? obj.suggestedTone : "",
    tactics,
    whatToAvoid,
    suggestedNextMove:
      typeof obj.suggestedNextMove === "string" ? obj.suggestedNextMove : "",
  };
}

export async function generatePublicCoaching(
  config: AIConfig,
  input: PublicCoachingInput
): Promise<{ result: PublicCoachingResult; tokensUsed: number } | null> {
  const systemPrompt = buildSystemPrompt(input);
  const userMessage = buildUserMessage(input);

  const aiResult = await callAIProvider(
    config,
    systemPrompt,
    [{ role: "user", content: userMessage }],
    1500
  );

  const parsed = tryParseCoaching(aiResult.text);
  if (!parsed) return null;

  return {
    result: parsed,
    tokensUsed: aiResult.tokensUsed,
  };
}
