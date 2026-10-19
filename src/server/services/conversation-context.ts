import { and, eq, sum } from "drizzle-orm";
import {
  conversationModes as conversationModesTable,
  fanTransactions,
} from "@/server/db/schema";
import type { ConversationModeContext } from "./ai";
import {
  resolveConversationMode,
  mergePersonalityWithMode,
  DEFAULT_CONVERSATION_MODES,
  type ConversationMode,
} from "./conversation-mode-resolver";
import { getExperimentModeConfig } from "./ab-experiment";
import type { BehavioralSignals } from "./scoring";

type Db = typeof import("@/server/db").db;

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

type ProfileLike = {
  engagementLevel: number | null;
  paymentProbability: number | null;
  funnelStage: string | null;
  behavioralSignals: unknown;
} | null;

/** Gasto total real del contacto (céntimos), sumando sus transacciones. */
export async function getContactTotalSpentCents(
  db: Db,
  creatorId: string,
  contactId: string
): Promise<number> {
  const [row] = await db
    .select({ total: sum(fanTransactions.amount) })
    .from(fanTransactions)
    .where(
      and(
        eq(fanTransactions.creatorId, creatorId),
        eq(fanTransactions.contactId, contactId)
      )
    );
  return Number(row?.total ?? 0);
}

export async function loadConversationModes(
  db: Db,
  creatorId: string
): Promise<ConversationMode[]> {
  const dbModes = await db.query.conversationModes.findMany({
    where: eq(conversationModesTable.creatorId, creatorId),
  });
  if (dbModes.length === 0) {
    return Object.values(DEFAULT_CONVERSATION_MODES).map((m) => ({ ...m, isActive: true }));
  }
  return dbModes.map((m) => ({
    modeType: m.modeType as ConversationMode["modeType"],
    name: m.name,
    description: m.description,
    tone: m.tone,
    style: m.style,
    messageLength: m.messageLength,
    objectives: (m.objectives as string[]) ?? [],
    restrictions: (m.restrictions as string[]) ?? [],
    additionalInstructions: m.additionalInstructions,
    activationCriteria: (m.activationCriteria as ConversationMode["activationCriteria"]) ?? {},
    priority: m.priority,
    isActive: m.isActive,
  }));
}

/**
 * Resuelve el modo de conversación (solo OnlyFans) para un contacto. Usa el
 * gasto real del contacto: antes `totalSpentCents` se leía de una columna
 * inexistente de contactProfiles (siempre 0) y el modo VIP era inalcanzable.
 */
export async function resolveModeForContact(
  db: Db,
  creatorId: string,
  contactId: string,
  profile: ProfileLike
): Promise<ConversationMode | null> {
  if (!profile) return null;
  const signals = (profile.behavioralSignals ?? {}) as Partial<BehavioralSignals>;
  const [modes, totalSpentCents] = await Promise.all([
    loadConversationModes(db, creatorId),
    getContactTotalSpentCents(db, creatorId, contactId),
  ]);
  return resolveConversationMode(modes, {
    engagementLevel: profile.engagementLevel ?? 0,
    paymentProbability: profile.paymentProbability ?? 0,
    funnelStage: profile.funnelStage ?? "cold",
    behavioralSignals: {
      messageCount: signals.messageCount,
      sentimentTrend: signals.sentimentTrend,
      lastMessageAt: (signals.lastMessageAt as string | null | undefined) ?? undefined,
    },
    totalSpentCents,
  });
}

/**
 * Personalidad final para generar sugerencias: personalidad de la plataforma
 * + modo de conversación (OnlyFans) + override del experimento A/B activo.
 * Antes este bloque estaba duplicado en `ai.suggest` y `ai.regenerate`.
 */
export async function resolvePersonalityForConversation(
  db: Db,
  args: {
    creatorId: string;
    contactId: string;
    platformType: string;
    platformPersonality: Record<string, unknown> | null | undefined;
    profile: ProfileLike;
  }
): Promise<{
  personality: PersonalityConfig;
  conversationMode?: ConversationModeContext;
}> {
  let personality = (args.platformPersonality ?? {}) as PersonalityConfig;
  if (args.platformType !== "onlyfans" || !args.profile) {
    return { personality };
  }

  const mode = await resolveModeForContact(db, args.creatorId, args.contactId, args.profile);
  if (!mode) return { personality };

  personality = mergePersonalityWithMode(personality, mode);
  const conversationMode: ConversationModeContext = {
    modeType: mode.modeType,
    modeName: mode.name,
    modeDescription: mode.description,
  };

  const exp = await getExperimentModeConfig(db, args.creatorId, mode.modeType, args.contactId);
  if (exp) {
    const c = exp.config;
    const overrides: PersonalityConfig = {};
    if (c.tone) overrides.tone = c.tone as string;
    if (c.style) overrides.style = c.style as string;
    if (c.messageLength) overrides.messageLength = c.messageLength as string;
    if (c.objectives) overrides.goals = c.objectives as string[];
    if (c.restrictions) overrides.restrictions = c.restrictions as string[];
    if (c.additionalInstructions) overrides.customInstructions = c.additionalInstructions as string;
    personality = { ...personality, ...overrides };
  }

  return { personality, conversationMode };
}
