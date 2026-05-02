import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getLanguageInstruction } from "./language-utils";

// ============================================================
// Types
// ============================================================

export type AIProvider = "anthropic" | "openai" | "google" | "minimax" | "kimi";

export type AIConfig = {
  provider: AIProvider;
  model: string;
  apiKey: string;
};

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

type ContactProfile = {
  engagementLevel: number;
  funnelStage: string;
  communicationStyle: Record<string, unknown>;
  paymentProbability: number;
};

type Message = {
  role: "fan" | "creator";
  content: string;
};

export type ConversationModeContext = {
  modeType: string;
  modeName: string;
  modeDescription: string | null;
};

export type SuggestionInput = {
  platformType: string;
  personality: PersonalityConfig;
  globalInstructions?: string;
  contactProfile: ContactProfile | null;
  conversationHistory: Message[];
  contactNotes: string[];
  fanMessage: string;
  conversationMode?: ConversationModeContext;
  language?: string;
};

type SuggestionResult = {
  suggestions: string[];
  variants: SuggestionVariant[];
  tokensUsed: number;
  model: string;
  provider: AIProvider;
};

export type AICallResult = {
  text: string;
  tokensUsed: number;
};

// ============================================================
// Available models per provider
// ============================================================

export const PROVIDER_MODELS: Record<AIProvider, { value: string; label: string }[]> = {
  anthropic: [
    { value: "claude-sonnet-4-6-20250514", label: "Claude Sonnet 4.6" },
    { value: "claude-opus-4-6-20250514", label: "Claude Opus 4.6" },
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
  ],
  google: [
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  ],
  minimax: [
    { value: "MiniMax-M1", label: "MiniMax-M2.7" },
    { value: "minimax-m2.5", label: "MiniMax-M2.5" },
    { value: "minimax-m2.5-chat", label: "MiniMax-M2.5 Chat" },
  ],
  kimi: [
    { value: "kimi-k2", label: "Kimi K2" },
    { value: "moonshot-v1-auto", label: "Moonshot V1 Auto" },
    { value: "moonshot-v1-32k", label: "Moonshot V1 32K" },
  ],
};

// ============================================================
// Prompt Builder (shared across providers)
// ============================================================

export type SuggestionVariant = {
  type: "casual" | "sales" | "retention";
  label: string;
  content: string;
};

function getVariantInstructions(
  funnelStage: string,
  conversationMode?: ConversationModeContext
): string {
  // OnlyFans conversation modes have specialized variants
  if (conversationMode) {
    const mode = conversationMode.modeType;

    if (mode === "LOW_VALUE") {
      return `Genera exactamente 3 variantes de respuesta con estos enfoques:
1. CASUAL: Respuesta minima y cordial
2. ENGAGEMENT: Intento sutil de reactivar interes
3. RETENTION: Cortar conversacion educadamente

Formato OBLIGATORIO - cada variante debe empezar con su etiqueta:
[CASUAL] <mensaje>
---
[ENGAGEMENT] <mensaje>
---
[RETENTION] <mensaje>`;
    }

    if (mode === "BASE") {
      return `Genera exactamente 3 variantes de respuesta con estos enfoques:
1. CASUAL: Tono misterioso y distante, generar curiosidad
2. ENGAGEMENT: Observar sin dar demasiado, dejar que pregunte
3. RETENTION: Mantener interes con misterio, sin presion

Formato OBLIGATORIO - cada variante debe empezar con su etiqueta:
[CASUAL] <mensaje>
---
[ENGAGEMENT] <mensaje>
---
[RETENTION] <mensaje>`;
    }

    if (mode === "POTENCIAL_PREMIUM") {
      return `Genera exactamente 3 variantes de respuesta con estos enfoques:
1. CASUAL: Tono selectivo y coqueto, crear vinculo
2. SALES: Insinuar exclusividad y progresion sin ofrecer directamente
3. RETENTION: Reforzar que la paciencia tiene recompensa

Formato OBLIGATORIO - cada variante debe empezar con su etiqueta:
[CASUAL] <mensaje>
---
[SALES] <mensaje>
---
[RETENTION] <mensaje>`;
    }

    if (mode === "CONVERSION") {
      return `Genera exactamente 3 variantes de respuesta con estos enfoques:
1. CASUAL: Tono seguro y misterioso, hablar de estructura
2. SALES: Orientar hacia acceso premium con lenguaje de exclusividad (nunca comercial)
3. RETENTION: Mantener tension y deseo sin cerrar del todo

Formato OBLIGATORIO - cada variante debe empezar con su etiqueta:
[CASUAL] <mensaje>
---
[SALES] <mensaje>
---
[RETENTION] <mensaje>`;
    }

    // VIP
    return `Genera exactamente 3 variantes de respuesta con estos enfoques:
1. CASUAL: Tono intimo y cercano, fortalecer relacion
2. SALES: Orientada a upsell o experiencia premium exclusiva
3. RETENTION: Hacer sentir unico y especial para fidelizar

Formato OBLIGATORIO - cada variante debe empezar con su etiqueta:
[CASUAL] <mensaje>
---
[SALES] <mensaje>
---
[RETENTION] <mensaje>`;
  }

  // Default behavior for non-OnlyFans platforms
  if (funnelStage === "cold" || funnelStage === "curious") {
    return `Genera exactamente 3 variantes de respuesta con estos enfoques:
1. CASUAL: Tono relajado y amistoso para generar confianza
2. ENGAGEMENT: Orientada a profundizar la conversacion y conocer mejor al fan
3. RETENTION: Mantener el interes sin presion

Formato OBLIGATORIO - cada variante debe empezar con su etiqueta:
[CASUAL] <mensaje>
---
[ENGAGEMENT] <mensaje>
---
[RETENTION] <mensaje>`;
  }

  if (funnelStage === "interested" || funnelStage === "hot_lead") {
    return `Genera exactamente 3 variantes de respuesta con estos enfoques:
1. CASUAL: Tono relajado y cercano
2. SALES: Orientada sutilmente hacia una conversion o compra
3. RETENTION: Mantener engagement sin presion de venta

Formato OBLIGATORIO - cada variante debe empezar con su etiqueta:
[CASUAL] <mensaje>
---
[SALES] <mensaje>
---
[RETENTION] <mensaje>`;
  }

  // buyer, vip
  return `Genera exactamente 3 variantes de respuesta con estos enfoques:
1. CASUAL: Tono relajado y personal para fortalecer la relacion
2. SALES: Orientada a upsell o contenido premium exclusivo
3. RETENTION: Hacer sentir especial al fan para fidelizarlo

Formato OBLIGATORIO - cada variante debe empezar con su etiqueta:
[CASUAL] <mensaje>
---
[SALES] <mensaje>
---
[RETENTION] <mensaje>`;
}

function buildSystemPrompt(input: SuggestionInput): string {
  const parts: string[] = [];

  const funnelStage = input.contactProfile?.funnelStage ?? "cold";
  const variantInstructions = getVariantInstructions(funnelStage, input.conversationMode);

  parts.push(`Eres un asistente de conversación para un creador de contenido.
Tu rol es generar sugerencias de respuesta que el creador copiará y enviará manualmente.

REGLAS IMPORTANTES:
- Responde SOLO con los mensajes sugeridos, sin explicaciones ni meta-comentarios
- Nunca reveles que eres una IA
- Nunca generes contenido que involucre menores
- Respeta las restricciones definidas por el creador
- ${variantInstructions}`);

  if (input.language) {
    parts.push(`\n${getLanguageInstruction(input.language)}`);
  }

  parts.push(`\nPLATAFORMA: ${input.platformType}`);

  if (input.personality) {
    const p = input.personality;
    if (p.role) parts.push(`ROL EN ESTA PLATAFORMA: ${p.role}`);
    if (p.tone) parts.push(`TONO: ${p.tone}`);
    if (p.style) parts.push(`ESTILO: ${p.style}`);
    if (p.messageLength) parts.push(`LONGITUD DE MENSAJES: ${p.messageLength}`);
    if (p.goals?.length) parts.push(`OBJETIVOS: ${p.goals.join(", ")}`);
    if (p.restrictions?.length)
      parts.push(`RESTRICCIONES: ${p.restrictions.join(", ")}`);
    if (p.exampleMessages?.length)
      parts.push(
        `EJEMPLOS DE ESTILO:\n${p.exampleMessages.map((m) => `- "${m}"`).join("\n")}`
      );
    if (p.customInstructions)
      parts.push(`INSTRUCCIONES ADICIONALES: ${p.customInstructions}`);
  }

  if (input.conversationMode) {
    parts.push(`\nMODO DE CONVERSACIÓN ACTIVO: ${input.conversationMode.modeName}`);
    if (input.conversationMode.modeDescription)
      parts.push(`DESCRIPCIÓN DEL MODO: ${input.conversationMode.modeDescription}`);
    parts.push(`TIPO DE MODO: ${input.conversationMode.modeType}`);
  }

  if (input.globalInstructions)
    parts.push(`\nINSTRUCCIONES GLOBALES DEL CREADOR (aplican siempre, en cualquier plataforma):\n${input.globalInstructions}`);

  if (input.contactProfile) {
    const cp = input.contactProfile;
    parts.push(`\nPERFIL DEL CONTACTO:`);
    parts.push(`- Engagement: ${cp.engagementLevel}/100`);
    parts.push(`- Etapa: ${cp.funnelStage}`);
    parts.push(`- Probabilidad de pago: ${cp.paymentProbability}/100`);
  }

  if (input.contactNotes.length > 0) {
    parts.push(`\nNOTAS DEL CREADOR SOBRE ESTE CONTACTO:`);
    input.contactNotes.forEach((note) => parts.push(`- ${note}`));
  }

  return parts.join("\n");
}

function buildConversationMessages(input: SuggestionInput) {
  const recentHistory = input.conversationHistory.slice(-20);
  const msgs: { role: "user" | "assistant"; content: string }[] = [];

  for (const msg of recentHistory) {
    msgs.push({
      role: msg.role === "fan" ? "user" : "assistant",
      content: msg.content,
    });
  }

  msgs.push({ role: "user", content: input.fanMessage });
  return msgs;
}

export function stripThinkingBlocks(text: string): string {
  // Remove <think>...</think> blocks from reasoning models (MiniMax, DeepSeek, etc.)
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function parseSuggestionVariants(text: string): SuggestionVariant[] {
  const cleaned = stripThinkingBlocks(text);
  const parts = cleaned
    .split("---")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const labelMap: Record<string, { type: SuggestionVariant["type"]; label: string }> = {
    CASUAL: { type: "casual", label: "Casual" },
    SALES: { type: "sales", label: "Venta" },
    ENGAGEMENT: { type: "retention", label: "Engagement" },
    RETENTION: { type: "retention", label: "Retencion" },
  };

  const variants: SuggestionVariant[] = [];
  for (const part of parts) {
    const tagMatch = part.match(/^\[(CASUAL|SALES|ENGAGEMENT|RETENTION)\]\s*/i);
    if (tagMatch) {
      const tag = tagMatch[1]!.toUpperCase();
      const content = part.slice(tagMatch[0].length).trim();
      const info = labelMap[tag] ?? { type: "casual" as const, label: "Casual" };
      variants.push({ type: info.type, label: info.label, content });
    } else {
      // Fallback: no tag found
      variants.push({ type: "casual", label: "Sugerencia", content: part });
    }
  }

  if (variants.length === 0) {
    variants.push({ type: "casual", label: "Sugerencia", content: cleaned });
  }

  return variants;
}

// ============================================================
// Generic AI Provider Call
// ============================================================

const OPENAI_COMPATIBLE_BASES: Record<string, string> = {
  minimax: "https://api.minimaxi.chat/v1",
  kimi: "https://api.moonshot.cn/v1",
};

export async function callAIProvider(
  config: AIConfig,
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[],
  maxTokens: number = 1024
): Promise<AICallResult> {
  switch (config.provider) {
    case "anthropic": {
      const client = new Anthropic({ apiKey: config.apiKey });
      const response = await client.messages.create({
        model: config.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      });
      const text =
        response.content[0]?.type === "text" ? response.content[0].text : "";
      const tokensUsed =
        (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
      return { text, tokensUsed };
    }

    case "openai": {
      const client = new OpenAI({ apiKey: config.apiKey });
      const oaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...messages,
      ];
      const response = await client.chat.completions.create({
        model: config.model,
        max_tokens: maxTokens,
        messages: oaiMessages,
      });
      const text = response.choices[0]?.message?.content ?? "";
      const tokensUsed =
        (response.usage?.prompt_tokens ?? 0) +
        (response.usage?.completion_tokens ?? 0);
      return { text, tokensUsed };
    }

    case "google": {
      const contents = messages.map((msg) => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      }));
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: { maxOutputTokens: maxTokens },
          }),
        }
      );
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Google AI error: ${error}`);
      }
      const data = await response.json();
      const text =
        data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const tokensUsed =
        (data.usageMetadata?.promptTokenCount ?? 0) +
        (data.usageMetadata?.candidatesTokenCount ?? 0);
      return { text, tokensUsed };
    }

    case "minimax":
    case "kimi": {
      const baseURL = OPENAI_COMPATIBLE_BASES[config.provider];
      if (!baseURL) {
        throw new Error(`No base URL for provider: ${config.provider}`);
      }
      const client = new OpenAI({ apiKey: config.apiKey, baseURL });
      const oaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...messages,
      ];
      const response = await client.chat.completions.create({
        model: config.model,
        max_tokens: maxTokens,
        messages: oaiMessages,
      });
      const text = response.choices[0]?.message?.content ?? "";
      const tokensUsed =
        (response.usage?.prompt_tokens ?? 0) +
        (response.usage?.completion_tokens ?? 0);
      return { text, tokensUsed };
    }

    default:
      throw new Error(`Unsupported AI provider: ${config.provider}`);
  }
}

// ============================================================
// Main entry point
// ============================================================

export async function generateSuggestion(
  config: AIConfig,
  input: SuggestionInput
): Promise<SuggestionResult> {
  const systemPrompt = buildSystemPrompt(input);
  const conversationMessages = buildConversationMessages(input);
  const result = await callAIProvider(config, systemPrompt, conversationMessages, 1024);

  const variants = parseSuggestionVariants(result.text);

  return {
    suggestions: variants.map((v) => v.content),
    variants,
    tokensUsed: result.tokensUsed,
    model: config.model,
    provider: config.provider,
  };
}
