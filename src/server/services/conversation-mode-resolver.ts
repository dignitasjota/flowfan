/**
 * Conversation Mode Resolver
 *
 * Determines the active conversation mode for OnlyFans contacts
 * based on their behavioral profile and scoring data.
 * Only affects how the AI generates responses.
 */

// ============================================================
// Types
// ============================================================

export type ConversationModeType =
  | "BASE"
  | "POTENCIAL_PREMIUM"
  | "CONVERSION"
  | "VIP"
  | "LOW_VALUE";

export type ActivationCriteria = {
  minEngagement?: number;
  maxEngagement?: number;
  minPaymentProbability?: number;
  maxPaymentProbability?: number;
  funnelStages?: string[];
  minTotalSpent?: number;
  minMessageCount?: number;
  minDaysSinceLastInteraction?: number;
  minSentimentTrend?: number;
};

export type ConversationMode = {
  modeType: ConversationModeType;
  name: string;
  description: string | null;
  tone: string | null;
  style: string | null;
  messageLength: string | null;
  objectives: string[];
  restrictions: string[];
  additionalInstructions: string | null;
  activationCriteria: ActivationCriteria;
  priority: number;
  isActive: boolean;
};

type ContactData = {
  engagementLevel: number;
  paymentProbability: number;
  funnelStage: string;
  behavioralSignals: {
    messageCount?: number;
    sentimentTrend?: number;
    lastMessageAt?: string;
  };
  totalSpentCents: number;
};

type PersonalityConfig = {
  role?: string;
  tone?: string;
  style?: string;
  messageLength?: string;
  goals?: string[];
  restrictions?: string[];
  customInstructions?: string;
};

// ============================================================
// Mode Resolution
// ============================================================

function matchesCriteria(
  criteria: ActivationCriteria,
  contact: ContactData
): boolean {
  const {
    minEngagement,
    maxEngagement,
    minPaymentProbability,
    maxPaymentProbability,
    funnelStages,
    minTotalSpent,
    minMessageCount,
    minDaysSinceLastInteraction,
    minSentimentTrend,
  } = criteria;

  if (minEngagement !== undefined && contact.engagementLevel < minEngagement)
    return false;
  if (maxEngagement !== undefined && contact.engagementLevel > maxEngagement)
    return false;
  if (
    minPaymentProbability !== undefined &&
    contact.paymentProbability < minPaymentProbability
  )
    return false;
  if (
    maxPaymentProbability !== undefined &&
    contact.paymentProbability > maxPaymentProbability
  )
    return false;
  if (
    funnelStages &&
    funnelStages.length > 0 &&
    !funnelStages.includes(contact.funnelStage)
  )
    return false;
  if (
    minTotalSpent !== undefined &&
    contact.totalSpentCents < minTotalSpent
  )
    return false;
  if (
    minMessageCount !== undefined &&
    (contact.behavioralSignals.messageCount ?? 0) < minMessageCount
  )
    return false;
  if (minSentimentTrend !== undefined) {
    const trend = contact.behavioralSignals.sentimentTrend ?? 0;
    if (trend < minSentimentTrend) return false;
  }
  if (minDaysSinceLastInteraction !== undefined) {
    const lastMsg = contact.behavioralSignals.lastMessageAt;
    if (lastMsg) {
      const daysSince =
        (Date.now() - new Date(lastMsg).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < minDaysSinceLastInteraction) return false;
    }
  }

  return true;
}

/**
 * Resolves which conversation mode should be active for a contact.
 * Modes are evaluated by priority (highest first). Returns the first match.
 * Falls back to BASE if no other mode matches.
 */
export function resolveConversationMode(
  modes: ConversationMode[],
  contact: ContactData
): ConversationMode | null {
  const activeModes = modes
    .filter((m) => m.isActive)
    .sort((a, b) => b.priority - a.priority);

  for (const mode of activeModes) {
    if (mode.modeType === "BASE") continue; // BASE is always the fallback
    if (matchesCriteria(mode.activationCriteria, contact)) {
      return mode;
    }
  }

  // Fallback to BASE
  return activeModes.find((m) => m.modeType === "BASE") ?? null;
}

/**
 * Merges the base platform personality with mode-specific overrides.
 * Mode fields take precedence over base personality when defined.
 */
export function mergePersonalityWithMode(
  basePersonality: PersonalityConfig,
  mode: ConversationMode
): PersonalityConfig {
  return {
    ...basePersonality,
    tone: mode.tone ?? basePersonality.tone,
    style: mode.style ?? basePersonality.style,
    messageLength: mode.messageLength ?? basePersonality.messageLength,
    goals:
      mode.objectives.length > 0 ? mode.objectives : basePersonality.goals,
    restrictions:
      mode.restrictions.length > 0
        ? mode.restrictions
        : basePersonality.restrictions,
    customInstructions:
      mode.additionalInstructions ?? basePersonality.customInstructions,
  };
}

// ============================================================
// Default Mode Definitions
// ============================================================

export const DEFAULT_CONVERSATION_MODES: Record<
  ConversationModeType,
  Omit<ConversationMode, "isActive">
> = {
  BASE: {
    modeType: "BASE",
    name: "Base / Observación",
    description:
      "Nuevos suscriptores, gente superficial, sin intención de pago",
    tone: "dulce, tímida",
    style: "misteriosa",
    messageLength: "short",
    objectives: [
      "filtrar",
      "observar comportamiento",
      "generar curiosidad",
      "evitar desgaste",
    ],
    restrictions: [
      "no sexting",
      "no contenido gratis",
      "no hablar de precios",
      "no profundidad emocional",
    ],
    additionalInstructions:
      "responde con calma, no hagas preguntas constantes, no intentes mantener conversación larga, deja silencios, no muestres interés fuerte",
    activationCriteria: {},
    priority: 0,
  },
  POTENCIAL_PREMIUM: {
    modeType: "POTENCIAL_PREMIUM",
    name: "Potencial Premium",
    description:
      "Es constante, respeta tiempos, no presiona, muestra interés en dinámica",
    tone: "dulce, selectiva",
    style: "coqueta, misteriosa",
    messageLength: "medium",
    objectives: [
      "crear vínculo",
      "generar progresión",
      "activar curiosidad por ritual",
      "preparar conversión",
    ],
    restrictions: [
      "no ofrecer directamente ritual",
      "no dar demasiado",
      "no parecer disponible",
    ],
    additionalInstructions:
      "introduce frases sobre paciencia, control y progresión, deja que él pregunte, usa insinuación emocional",
    activationCriteria: {
      minEngagement: 30,
      minPaymentProbability: 20,
      minMessageCount: 5,
    },
    priority: 20,
  },
  CONVERSION: {
    modeType: "CONVERSION",
    name: "Conversión / Ritual",
    description:
      "Ha mostrado interés claro, pregunta más profundo, mantiene calma, tiene perfil de pago",
    tone: "dulce, segura",
    style: "misteriosa, selectiva",
    messageLength: "medium",
    objectives: [
      "hacer que pida el ritual",
      "explicar sin vender",
      "cerrar acceso premium",
    ],
    restrictions: [
      "no sonar comercial",
      "no negociar precio",
      "no justificar demasiado",
    ],
    additionalInstructions:
      "habla de estructura, exclusividad y ritmo, nunca uses lenguaje de oferta, usa lenguaje de acceso limitado",
    activationCriteria: {
      funnelStages: ["interested", "hot_lead"],
      minPaymentProbability: 40,
      minSentimentTrend: 0,
    },
    priority: 30,
  },
  VIP: {
    modeType: "VIP",
    name: "Alto Valor / VIP Activo",
    description: "Ya paga, está dentro de ritual, es recurrente",
    tone: "dulce, cercana",
    style: "coqueta, íntima",
    messageLength: "medium",
    objectives: [
      "retención",
      "aumentar ticket medio",
      "mantener dinámica",
      "reforzar vínculo",
    ],
    restrictions: [
      "no dependencia emocional real",
      "no 24/7",
      "no perder control",
    ],
    additionalInstructions:
      "hazle sentir especial pero no único absoluto, introduce progresión, mantén estructura, refuerza exclusividad",
    activationCriteria: {
      funnelStages: ["buyer", "vip"],
      minTotalSpent: 5000,
      minEngagement: 60,
    },
    priority: 40,
  },
  LOW_VALUE: {
    modeType: "LOW_VALUE",
    name: "Bajo Valor / Descarte",
    description: "Pide gratis, es agresivo, quiere quedar, presiona",
    tone: "frío, corto",
    style: "distante",
    messageLength: "short",
    objectives: ["cortar o enfriar"],
    restrictions: ["no discutir", "no justificar"],
    additionalInstructions:
      "respuestas mínimas, no invertir energía, cortar conversación si insiste",
    activationCriteria: {
      maxEngagement: 15,
      minMessageCount: 10,
      minDaysSinceLastInteraction: 7,
    },
    priority: 10,
  },
};
