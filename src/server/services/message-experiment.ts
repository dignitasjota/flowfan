import { and, desc, eq } from "drizzle-orm";
import {
  messageExperiments,
  messageExperimentSends,
} from "@/server/db/schema";
import { twoProportionConfidence } from "./ab-stats";

export type MessageVariant = {
  key: string;
  label: string;
  content: string;
};

// ============================================================
// Variant selection
// ============================================================

/**
 * Elige una variante de forma uniforme y aleatoria. Cada envío es independiente
 * (a diferencia del A/B de conversation modes, que asigna por contacto): aquí se
 * prueba qué CONTENIDO convierte mejor, así que un mismo contacto puede recibir
 * variantes distintas en envíos distintos.
 *
 * `rng` es inyectable para tests deterministas (por defecto Math.random no está
 * disponible en algunos sandboxes, así que el caller debe pasar uno cuando lo
 * necesite; el router usa crypto).
 */
export function pickVariant(
  variants: MessageVariant[],
  rng: () => number
): MessageVariant | null {
  if (!variants.length) return null;
  const idx = Math.min(
    variants.length - 1,
    Math.max(0, Math.floor(rng() * variants.length))
  );
  return variants[idx];
}

// ============================================================
// Recording
// ============================================================

export async function recordExperimentSend(
  db: any,
  args: {
    experimentId: string;
    creatorId: string;
    contactId: string;
    variantKey: string;
    messageId?: string | null;
  }
): Promise<string> {
  const [row] = await db
    .insert(messageExperimentSends)
    .values({
      experimentId: args.experimentId,
      creatorId: args.creatorId,
      contactId: args.contactId,
      variantKey: args.variantKey,
      messageId: args.messageId ?? null,
    })
    .returning({ id: messageExperimentSends.id });
  return row.id;
}

/**
 * Marca como "respondido" el send abierto (replied=false) más reciente de un
 * contacto en experimentos que sigan corriendo. Se llama cuando el fan responde.
 * Idempotente: si no hay send abierto no hace nada.
 */
export async function markExperimentReplyForContact(
  db: any,
  creatorId: string,
  contactId: string,
  sentiment?: number | null
): Promise<void> {
  const openSends = await db.query.messageExperimentSends.findMany({
    where: and(
      eq(messageExperimentSends.creatorId, creatorId),
      eq(messageExperimentSends.contactId, contactId),
      eq(messageExperimentSends.replied, false)
    ),
    with: { experiment: true },
    orderBy: [desc(messageExperimentSends.sentAt)],
  });

  const target = openSends.find(
    (s: any) => s.experiment?.status === "running"
  );
  if (!target) return;

  await db
    .update(messageExperimentSends)
    .set({
      replied: true,
      repliedAt: new Date(),
      replySentiment: sentiment ?? null,
    })
    .where(eq(messageExperimentSends.id, target.id));
}

/**
 * Marca como "convertido" los sends recientes del contacto que ya habían
 * recibido respuesta pero aún no estaban marcados como conversión. Se llama
 * cuando el contacto avanza de funnel stage.
 */
export async function markExperimentConversionForContact(
  db: any,
  creatorId: string,
  contactId: string
): Promise<void> {
  const sends = await db.query.messageExperimentSends.findMany({
    where: and(
      eq(messageExperimentSends.creatorId, creatorId),
      eq(messageExperimentSends.contactId, contactId),
      eq(messageExperimentSends.converted, false)
    ),
    with: { experiment: true },
    orderBy: [desc(messageExperimentSends.sentAt)],
  });

  const target = sends.find((s: any) => s.experiment?.status === "running");
  if (!target) return;

  await db
    .update(messageExperimentSends)
    .set({ converted: true, convertedAt: new Date() })
    .where(eq(messageExperimentSends.id, target.id));
}

// ============================================================
// Results
// ============================================================

export type VariantResult = {
  key: string;
  label: string;
  sends: number;
  replies: number;
  replyRate: number;
  conversions: number;
  conversionRate: number;
  avgReplySentiment: number | null;
};

export type MessageExperimentResults = {
  variants: VariantResult[];
  /** Mejor variante por conversionRate con muestra suficiente, o null. */
  leaderKey: string | null;
  /** Confianza (0-1) del líder frente al segundo, z-test de conversión. */
  confidence: number;
  suggestedWinnerKey: string | null;
};

/**
 * Calcula resultados a partir de la lista de sends y la definición de variantes.
 * Función pura para poder testear sin DB.
 */
export function computeMessageExperimentResults(
  variants: MessageVariant[],
  sends: Array<{
    variantKey: string;
    replied: boolean;
    converted: boolean;
    replySentiment: number | null;
  }>
): MessageExperimentResults {
  const perVariant: VariantResult[] = variants.map((v) => {
    const vs = sends.filter((s) => s.variantKey === v.key);
    const sendCount = vs.length;
    const replies = vs.filter((s) => s.replied).length;
    const conversions = vs.filter((s) => s.converted).length;
    const sentiments = vs
      .map((s) => s.replySentiment)
      .filter((x): x is number => typeof x === "number");
    const avgReplySentiment =
      sentiments.length > 0
        ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length
        : null;

    return {
      key: v.key,
      label: v.label,
      sends: sendCount,
      replies,
      replyRate: sendCount > 0 ? replies / sendCount : 0,
      conversions,
      conversionRate: sendCount > 0 ? conversions / sendCount : 0,
      avgReplySentiment,
    };
  });

  // Ordenar por conversionRate desc para hallar líder y segundo.
  const ranked = [...perVariant].sort(
    (a, b) => b.conversionRate - a.conversionRate
  );
  const leader = ranked[0] ?? null;
  const runnerUp = ranked[1] ?? null;

  let confidence = 0;
  if (leader && runnerUp) {
    confidence = twoProportionConfidence(
      leader.sends,
      leader.conversionRate,
      runnerUp.sends,
      runnerUp.conversionRate
    );
  }

  const leaderKey = leader && leader.sends > 0 ? leader.key : null;
  const suggestedWinnerKey = confidence >= 0.95 ? leaderKey : null;

  return { variants: perVariant, leaderKey, confidence, suggestedWinnerKey };
}

export async function calculateMessageExperimentResults(
  db: any,
  experimentId: string
): Promise<MessageExperimentResults> {
  const experiment = await db.query.messageExperiments.findFirst({
    where: eq(messageExperiments.id, experimentId),
  });
  const variants = (experiment?.variants ?? []) as MessageVariant[];

  const sends = await db.query.messageExperimentSends.findMany({
    where: eq(messageExperimentSends.experimentId, experimentId),
    columns: {
      variantKey: true,
      replied: true,
      converted: true,
      replySentiment: true,
    },
  });

  return computeMessageExperimentResults(variants, sends);
}
