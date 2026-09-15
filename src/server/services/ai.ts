import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getLanguageInstruction } from "./language-utils";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("ai-provider");

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
  /** ARCH-3: razón de parada normalizada entre proveedores (ver AI-4). */
  stopReason?: "stop" | "length" | "other";
};

// ============================================================
// ARCH-11: registry central de modelos (reemplaza el `PROVIDER_MODELS` plano)
// ============================================================

export type ModelMetadata = {
  value: string;
  label: string;
  /** Ventana de contexto aproximada, en tokens. Informativo por ahora. */
  contextWindow: number;
  /**
   * Modelos razonadores (MiniMax, DeepSeek, ...) gastan parte del presupuesto
   * de `maxTokens` en un bloque `<think>` interno antes de la respuesta real.
   * Con un `maxTokens` bajo (p.ej. 100-512, típico de clasificación/análisis
   * de sentimiento) la respuesta se corta a mitad del `<think>` y el parser
   * JSON no encuentra nada que parsear (AI-4). `callAIProvider` usa este flag
   * para subir el presupuesto mínimo automáticamente en esos casos.
   */
  isReasoner?: boolean;
};

export const MODEL_REGISTRY: Record<AIProvider, ModelMetadata[]> = {
  anthropic: [
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", contextWindow: 200_000 },
    { value: "claude-opus-4-6", label: "Claude Opus 4.6", contextWindow: 200_000 },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", contextWindow: 200_000 },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o", contextWindow: 128_000 },
    { value: "gpt-4o-mini", label: "GPT-4o Mini", contextWindow: 128_000 },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo", contextWindow: 128_000 },
  ],
  google: [
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", contextWindow: 1_000_000 },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", contextWindow: 1_000_000 },
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", contextWindow: 1_000_000 },
  ],
  minimax: [
    { value: "MiniMax-M1", label: "MiniMax-M2.7", contextWindow: 1_000_000, isReasoner: true },
    { value: "minimax-m2.5", label: "MiniMax-M2.5", contextWindow: 256_000 },
    { value: "minimax-m2.5-chat", label: "MiniMax-M2.5 Chat", contextWindow: 256_000 },
  ],
  kimi: [
    { value: "kimi-k2", label: "Kimi K2", contextWindow: 128_000 },
    { value: "moonshot-v1-auto", label: "Moonshot V1 Auto", contextWindow: 128_000 },
    { value: "moonshot-v1-32k", label: "Moonshot V1 32K", contextWindow: 32_000 },
  ],
};

/** Forma plana `{value,label}` que consume la UI de Settings — derivada del registry. */
export const PROVIDER_MODELS: Record<AIProvider, { value: string; label: string }[]> =
  Object.fromEntries(
    Object.entries(MODEL_REGISTRY).map(([provider, models]) => [
      provider,
      models.map(({ value, label }) => ({ value, label })),
    ])
  ) as Record<AIProvider, { value: string; label: string }[]>;

export function getModelMetadata(provider: AIProvider, model: string): ModelMetadata | undefined {
  return MODEL_REGISTRY[provider]?.find((m) => m.value === model);
}

export function isReasonerModel(provider: AIProvider, model: string): boolean {
  return getModelMetadata(provider, model)?.isReasoner ?? false;
}

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

// ARCH-5: separamos el prompt en un prefijo ESTABLE (reglas, idioma,
// plataforma, personalidad, modo de conversación, instrucciones globales —
// depende solo de creator+platform, idéntico entre mensajes consecutivos del
// mismo chat) y un sufijo VARIABLE (perfil del contacto + notas, cambia por
// contacto). El prefijo es el candidato a `cache_control: {type:"ephemeral"}`
// de Anthropic (~90% menos coste de input en conversaciones activas, ya que
// el prefijo se repite en cada sugerencia dentro de la ventana de 5 min del
// caché). Solo Anthropic soporta este mecanismo explícito hoy — el resto de
// proveedores reciben ambas partes concatenadas, sin cambio de comportamiento.
type SplitSystemPrompt = { cached: string; rest: string };

function buildSystemPrompt(input: SuggestionInput): SplitSystemPrompt {
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

  const cached = parts.join("\n");

  const restParts: string[] = [];
  if (input.contactProfile) {
    const cp = input.contactProfile;
    restParts.push(`\nPERFIL DEL CONTACTO:`);
    restParts.push(`- Engagement: ${cp.engagementLevel}/100`);
    restParts.push(`- Etapa: ${cp.funnelStage}`);
    restParts.push(`- Probabilidad de pago: ${cp.paymentProbability}/100`);
  }

  if (input.contactNotes.length > 0) {
    restParts.push(`\nNOTAS DEL CREADOR SOBRE ESTE CONTACTO:`);
    input.contactNotes.forEach((note) => restParts.push(`- ${note}`));
  }

  return { cached, rest: restParts.join("\n") };
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
  // AI-4: también eliminar un <think> SIN cerrar — ocurre cuando la respuesta se
  // trunca (finish_reason=length) dentro del bloque de razonamiento; si no se
  // elimina, el parser no encuentra JSON y cae a un fallback neutral silencioso.
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .trim();
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

// ARCH-3: timeout y reintentos únicos para toda llamada a un proveedor de IA.
// Los SDK de Anthropic/OpenAI ya traen los suyos propios (~10 min, 2 retries)
// pero son implícitos y demasiado largos para una mutación tRPC que un
// usuario está esperando en pantalla; los hacemos explícitos aquí para que
// los 5 proveedores se comporten igual y sea un único sitio donde ajustarlos.
const AI_CALL_TIMEOUT_MS = 60_000;
const AI_CALL_MAX_RETRIES = 2;
// ARCH-11: presupuesto mínimo para modelos razonadores (ver `isReasonerModel`).
const REASONER_MIN_BUDGET = 2000;

function normalizeStopReason(raw: string | null | undefined): "stop" | "length" | "other" {
  if (!raw) return "other";
  const upper = raw.toUpperCase();
  if (upper === "END_TURN" || upper === "STOP" || upper === "STOP_SEQUENCE") return "stop";
  if (upper === "MAX_TOKENS" || upper === "LENGTH") return "length";
  return "other";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Google no tiene SDK propio (fetch crudo) — reintento manual en 429/5xx.
 *
 * El error de red (fetch rechaza: DNS, abort por timeout...) y el error de
 * status HTTP (respuesta recibida pero no-ok) se manejan por separado a
 * propósito: un status no-retryable (400, 401...) debe propagarse en el acto,
 * no caer en el mismo `catch` que reintenta los fallos de red — de lo
 * contrario un 400 se reintentaría igual (bug real, detectado por el test
 * "no reintenta un 400").
 */
async function fetchGoogleWithRetry(
  model: string,
  apiKey: string,
  body: unknown
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= AI_CALL_MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // AI-6: API key en header, no en la query string (quedaba en logs
            // de proxies/APM y en error.cause de fetch fallidos).
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(body),
          // AI-6: timeout explícito (los SDK de Anthropic/OpenAI ya traen uno;
          // Google via fetch podía colgar la mutación tRPC indefinidamente).
          signal: AbortSignal.timeout(AI_CALL_TIMEOUT_MS),
        }
      );
    } catch (err) {
      if (attempt === AI_CALL_MAX_RETRIES) throw err;
      lastError = err;
      await sleep(500 * (attempt + 1));
      continue;
    }

    if (response.ok) return response;

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === AI_CALL_MAX_RETRIES) {
      const error = await response.text();
      throw new Error(`Google AI error (${response.status}): ${error}`);
    }
    lastError = new Error(`Google AI error (${response.status}), retrying`);
    await sleep(500 * (attempt + 1));
  }
  throw lastError instanceof Error ? lastError : new Error("Google AI call failed");
}

/** Concatena la parte cacheable + variable para los proveedores que no soportan `cache_control` explícito. */
function flattenSystemPrompt(systemPrompt: string | SplitSystemPrompt): string {
  return typeof systemPrompt === "string"
    ? systemPrompt
    : [systemPrompt.cached, systemPrompt.rest].filter(Boolean).join("\n");
}

async function callProviderRaw(
  config: AIConfig,
  systemPrompt: string | SplitSystemPrompt,
  messages: { role: "user" | "assistant"; content: string }[],
  maxTokens: number
): Promise<AICallResult> {
  switch (config.provider) {
    case "anthropic": {
      const client = new Anthropic({
        apiKey: config.apiKey,
        timeout: AI_CALL_TIMEOUT_MS,
        maxRetries: AI_CALL_MAX_RETRIES,
      });
      // ARCH-5: si viene partido en {cached, rest}, marcamos el prefijo
      // estable con `cache_control: {type:"ephemeral"}` — Anthropic cachea
      // ese prefijo ~5 min y lo reutiliza en la siguiente sugerencia del
      // mismo chat en vez de volver a facturarlo como input completo.
      const system: string | Anthropic.Messages.TextBlockParam[] =
        typeof systemPrompt === "string"
          ? systemPrompt
          : [
              {
                type: "text",
                text: systemPrompt.cached,
                cache_control: { type: "ephemeral" },
              },
              ...(systemPrompt.rest ? [{ type: "text" as const, text: systemPrompt.rest }] : []),
            ];
      const response = await client.messages.create({
        model: config.model,
        max_tokens: maxTokens,
        system,
        messages,
      });
      const text =
        response.content[0]?.type === "text" ? response.content[0].text : "";
      const tokensUsed =
        (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
      return { text, tokensUsed, stopReason: normalizeStopReason(response.stop_reason) };
    }

    case "openai": {
      const client = new OpenAI({
        apiKey: config.apiKey,
        timeout: AI_CALL_TIMEOUT_MS,
        maxRetries: AI_CALL_MAX_RETRIES,
      });
      const oaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: flattenSystemPrompt(systemPrompt) },
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
      return {
        text,
        tokensUsed,
        stopReason: normalizeStopReason(response.choices[0]?.finish_reason),
      };
    }

    case "google": {
      const contents = messages.map((msg) => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      }));
      const response = await fetchGoogleWithRetry(config.model, config.apiKey, {
        system_instruction: { parts: [{ text: flattenSystemPrompt(systemPrompt) }] },
        contents,
        generationConfig: { maxOutputTokens: maxTokens },
      });
      const data = await response.json();
      const text =
        data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const tokensUsed =
        (data.usageMetadata?.promptTokenCount ?? 0) +
        (data.usageMetadata?.candidatesTokenCount ?? 0);
      return {
        text,
        tokensUsed,
        stopReason: normalizeStopReason(data.candidates?.[0]?.finishReason),
      };
    }

    case "minimax":
    case "kimi": {
      const baseURL = OPENAI_COMPATIBLE_BASES[config.provider];
      if (!baseURL) {
        throw new Error(`No base URL for provider: ${config.provider}`);
      }
      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL,
        timeout: AI_CALL_TIMEOUT_MS,
        maxRetries: AI_CALL_MAX_RETRIES,
      });
      const oaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: flattenSystemPrompt(systemPrompt) },
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
      return {
        text,
        tokensUsed,
        stopReason: normalizeStopReason(response.choices[0]?.finish_reason),
      };
    }

    default:
      throw new Error(`Unsupported AI provider: ${config.provider}`);
  }
}

export async function callAIProvider(
  config: AIConfig,
  systemPrompt: string | SplitSystemPrompt,
  messages: { role: "user" | "assistant"; content: string }[],
  maxTokens: number = 1024
): Promise<AICallResult> {
  // ARCH-11: subir el presupuesto mínimo para modelos razonadores — ver
  // `REASONER_MIN_BUDGET`. No afecta a proveedores/modelos no marcados como
  // razonadores en el registry (el `maxTokens` pedido pasa sin cambios).
  const effectiveMaxTokens = isReasonerModel(config.provider, config.model)
    ? Math.max(maxTokens, REASONER_MIN_BUDGET)
    : maxTokens;

  const startedAt = Date.now();
  try {
    const result = await callProviderRaw(config, systemPrompt, messages, effectiveMaxTokens);
    log.info(
      {
        provider: config.provider,
        model: config.model,
        latencyMs: Date.now() - startedAt,
        stopReason: result.stopReason,
        tokensUsed: result.tokensUsed,
      },
      "AI provider call succeeded"
    );
    if (result.stopReason === "length") {
      // AI-4: visibilidad — antes esto pasaba desapercibido y degradaba a un
      // fallback neutral silencioso en el parser JSON del caller.
      log.warn(
        { provider: config.provider, model: config.model, maxTokens: effectiveMaxTokens },
        "AI response truncated (stop_reason=length)"
      );
    }
    return result;
  } catch (err) {
    log.error(
      {
        provider: config.provider,
        model: config.model,
        latencyMs: Date.now() - startedAt,
        err,
      },
      "AI provider call failed"
    );
    throw err;
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
