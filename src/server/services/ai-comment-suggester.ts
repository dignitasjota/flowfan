import {
  callAIProvider,
  stripThinkingBlocks,
  type AIConfig,
  type AIProvider,
  type SuggestionVariant,
} from "./ai";
import { getLanguageInstruction } from "./language-utils";

type PersonalityConfig = {
  role?: string;
  tone?: string;
  style?: string;
  messageLength?: string;
  goals?: string[];
  restrictions?: string[];
  exampleMessages?: string[];
  customInstructions?: string;
};

type AuthorProfile = {
  engagementLevel: number;
  funnelStage: string;
  paymentProbability: number;
} | null;

type ThreadComment = {
  role: "fan" | "creator";
  authorUsername: string;
  content: string;
};

export type CommentSuggestionInput = {
  platformType: string;
  personality: PersonalityConfig;
  globalInstructions?: string;
  language?: string;
  post: {
    title?: string | null;
    content?: string | null;
    url?: string | null;
  };
  thread: ThreadComment[];
  fanComment: {
    authorUsername: string;
    content: string;
  };
  authorProfile: AuthorProfile;
  contactNotes: string[];
};

export type CommentSuggestionResult = {
  suggestions: string[];
  variants: SuggestionVariant[];
  tokensUsed: number;
  model: string;
  provider: AIProvider;
};

function buildSystemPrompt(input: CommentSuggestionInput): string {
  const parts: string[] = [];

  parts.push(`Eres un asistente que ayuda a un creador de contenido a responder a comentarios PUBLICOS en sus publicaciones.

CONTEXTO CRITICO - ESTOS MENSAJES SON PUBLICOS:
- Cualquier persona puede leer la respuesta, no solo el comentarista
- La respuesta refleja la marca personal del creador
- Manten un tono profesional y autentico, evita parecer agresivo o desesperado
- NO menciones precios, ofertas privadas, contenido exclusivo, ni invites a DM en el comentario publico
- Si quieres mover la conversacion a privado, hazlo de forma sutil y solo si es natural
- NO reveles datos personales del creador ni de otros fans
- Mantente breve: los comentarios largos pierden engagement

REGLAS DE GENERACION:
- Responde SOLO con las variantes sugeridas, sin explicaciones ni meta-comentarios
- Nunca reveles que eres una IA
- Nunca generes contenido que involucre menores
- Respeta las restricciones definidas por el creador
- Genera exactamente 3 variantes de respuesta con estos enfoques:

1. CASUAL: Respuesta breve, calida, que muestre personalidad sin entrar en venta
2. ENGAGEMENT: Devuelve una pregunta o hook para mantener la conversacion publica viva
3. RETENTION: Respuesta que valida al fan y refuerza la relacion sin presion comercial

Formato OBLIGATORIO - cada variante debe empezar con su etiqueta:
[CASUAL] <mensaje>
---
[ENGAGEMENT] <mensaje>
---
[RETENTION] <mensaje>`);

  if (input.language) {
    parts.push(`\n${getLanguageInstruction(input.language)}`);
  }

  parts.push(`\nPLATAFORMA: ${input.platformType} (comentario publico)`);

  if (input.personality) {
    const p = input.personality;
    if (p.role) parts.push(`ROL EN ESTA PLATAFORMA: ${p.role}`);
    if (p.tone) parts.push(`TONO: ${p.tone}`);
    if (p.style) parts.push(`ESTILO: ${p.style}`);
    if (p.messageLength) parts.push(`LONGITUD: corta (es un comentario publico, no un DM)`);
    if (p.goals?.length)
      parts.push(`OBJETIVOS GENERALES: ${p.goals.join(", ")}`);
    if (p.restrictions?.length)
      parts.push(`RESTRICCIONES: ${p.restrictions.join(", ")}`);
    if (p.customInstructions)
      parts.push(`INSTRUCCIONES ADICIONALES: ${p.customInstructions}`);
  }

  if (input.globalInstructions) {
    parts.push(
      `\nINSTRUCCIONES GLOBALES DEL CREADOR:\n${input.globalInstructions}`
    );
  }

  parts.push(`\nPUBLICACION ORIGINAL:`);
  if (input.post.title) parts.push(`Titulo: ${input.post.title}`);
  if (input.post.content) parts.push(`Contenido: ${input.post.content}`);
  if (input.post.url) parts.push(`URL: ${input.post.url}`);

  if (input.authorProfile) {
    const ap = input.authorProfile;
    parts.push(`\nPERFIL DEL COMENTARISTA (si existe como contacto):`);
    parts.push(`- Engagement: ${ap.engagementLevel}/100`);
    parts.push(`- Etapa: ${ap.funnelStage}`);
    parts.push(`- Probabilidad de pago: ${ap.paymentProbability}/100`);
  } else {
    parts.push(
      `\nNOTA: el comentarista no esta vinculado a un contacto del CRM (primer contacto publico).`
    );
  }

  if (input.contactNotes.length > 0) {
    parts.push(`\nNOTAS DEL CREADOR SOBRE ESTE CONTACTO:`);
    input.contactNotes.forEach((n) => parts.push(`- ${n}`));
  }

  return parts.join("\n");
}

function buildConversationMessages(input: CommentSuggestionInput) {
  const msgs: { role: "user" | "assistant"; content: string }[] = [];

  for (const c of input.thread.slice(-10)) {
    msgs.push({
      role: c.role === "fan" ? "user" : "assistant",
      content: `[${c.authorUsername}] ${c.content}`,
    });
  }

  msgs.push({
    role: "user",
    content: `[${input.fanComment.authorUsername}] ${input.fanComment.content}`,
  });

  return msgs;
}

function parseVariants(text: string): SuggestionVariant[] {
  const cleaned = stripThinkingBlocks(text);
  const parts = cleaned
    .split("---")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const labelMap: Record<
    string,
    { type: SuggestionVariant["type"]; label: string }
  > = {
    CASUAL: { type: "casual", label: "Casual" },
    ENGAGEMENT: { type: "retention", label: "Engagement" },
    RETENTION: { type: "retention", label: "Retencion" },
    SALES: { type: "sales", label: "Venta" },
  };

  const variants: SuggestionVariant[] = [];
  for (const part of parts) {
    const tagMatch = part.match(/^\[(CASUAL|ENGAGEMENT|RETENTION|SALES)\]\s*/i);
    if (tagMatch) {
      const tag = tagMatch[1]!.toUpperCase();
      const content = part.slice(tagMatch[0].length).trim();
      const info = labelMap[tag] ?? { type: "casual" as const, label: "Casual" };
      variants.push({ type: info.type, label: info.label, content });
    } else {
      variants.push({ type: "casual", label: "Sugerencia", content: part });
    }
  }

  if (variants.length === 0) {
    variants.push({ type: "casual", label: "Sugerencia", content: cleaned });
  }

  return variants;
}

export async function generateCommentSuggestion(
  config: AIConfig,
  input: CommentSuggestionInput
): Promise<CommentSuggestionResult> {
  const systemPrompt = buildSystemPrompt(input);
  const conversationMessages = buildConversationMessages(input);
  const result = await callAIProvider(
    config,
    systemPrompt,
    conversationMessages,
    768
  );

  const variants = parseVariants(result.text);

  return {
    suggestions: variants.map((v) => v.content),
    variants,
    tokensUsed: result.tokensUsed,
    model: config.model,
    provider: config.provider,
  };
}
