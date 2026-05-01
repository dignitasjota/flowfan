import { eq, and } from "drizzle-orm";
import { contacts, contactProfiles, notifications, creators } from "@/server/db/schema";
import { emailQueue } from "@/server/queues";
import { createChildLogger } from "@/lib/logger";
import type { BehavioralSignals } from "./scoring";

const log = createChildLogger("churn-prediction");

type DB = Parameters<Parameters<typeof import("@/server/db").db.transaction>[0]>[0] | typeof import("@/server/db").db;

export type ChurnFactor = {
  name: string;
  score: number;
  weight: number;
  description: string;
};

export type ChurnResult = {
  score: number;
  factors: ChurnFactor[];
  riskLevel: "low" | "medium" | "high" | "critical";
};

type ProfileData = {
  engagementLevel: number;
  funnelStage: string;
  scoringHistory: unknown;
};

type ContactData = {
  lastInteractionAt: Date;
};

// ============================================================
// Score calculation
// ============================================================

function recencyDecayScore(daysSinceLastMessage: number): number {
  if (daysSinceLastMessage <= 0) return 0;
  if (daysSinceLastMessage <= 3) return 15;
  if (daysSinceLastMessage <= 7) return 35;
  if (daysSinceLastMessage <= 14) return 60;
  if (daysSinceLastMessage <= 30) return 90;
  return 100;
}

function engagementDropScore(currentEngagement: number, history: unknown): number {
  const historyArray = Array.isArray(history) ? history : [];
  if (historyArray.length < 2) return 0;

  let peakEngagement = 0;
  for (const entry of historyArray) {
    const e = (entry as { engagementLevel?: number }).engagementLevel ?? 0;
    if (e > peakEngagement) peakEngagement = e;
  }

  if (peakEngagement <= 0) return 0;
  const dropPercent = ((peakEngagement - currentEngagement) / peakEngagement) * 100;
  return Math.min(100, Math.max(0, dropPercent));
}

function sentimentTrendScore(sentimentTrend: number): number {
  // sentimentTrend ranges from -1 (worsening) to 1 (improving)
  // Map to 0 (improving) to 100 (worsening)
  return Math.min(100, Math.max(0, ((1 - sentimentTrend) / 2) * 100));
}

function frequencyDeclineScore(signals: BehavioralSignals | null): number {
  if (!signals || signals.messageCount < 5) return 50; // Not enough data
  // Higher avgTimeBetweenMessages = less frequent = higher churn risk
  const avgMinutes = signals.avgTimeBetweenMessages;
  if (avgMinutes <= 60) return 0;        // Very active
  if (avgMinutes <= 360) return 20;       // Active
  if (avgMinutes <= 1440) return 40;      // Daily
  if (avgMinutes <= 4320) return 60;      // Every 3 days
  if (avgMinutes <= 10080) return 80;     // Weekly
  return 100;                             // Very infrequent
}

const FUNNEL_CHURN_SCORES: Record<string, number> = {
  cold: 80,
  curious: 50,
  interested: 30,
  hot_lead: 15,
  buyer: 10,
  vip: 5,
};

function funnelStageScore(stage: string): number {
  return FUNNEL_CHURN_SCORES[stage] ?? 50;
}

function getRiskLevel(score: number): "low" | "medium" | "high" | "critical" {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

export function calculateChurnScore(
  signals: BehavioralSignals | null,
  profile: ProfileData,
  contact: ContactData
): ChurnResult {
  const daysSince = (Date.now() - contact.lastInteractionAt.getTime()) / (1000 * 60 * 60 * 24);

  const factors: ChurnFactor[] = [
    {
      name: "recency",
      score: recencyDecayScore(daysSince),
      weight: 0.30,
      description: `${Math.floor(daysSince)} dias sin interaccion`,
    },
    {
      name: "engagement_drop",
      score: engagementDropScore(profile.engagementLevel, profile.scoringHistory),
      weight: 0.25,
      description: `Engagement actual: ${profile.engagementLevel}`,
    },
    {
      name: "sentiment_trend",
      score: sentimentTrendScore(signals?.sentimentTrend ?? 0),
      weight: 0.15,
      description: `Tendencia: ${(signals?.sentimentTrend ?? 0) > 0 ? "mejorando" : "empeorando"}`,
    },
    {
      name: "frequency_decline",
      score: frequencyDeclineScore(signals),
      weight: 0.15,
      description: `Frecuencia: cada ${Math.round(signals?.avgTimeBetweenMessages ?? 0)}min`,
    },
    {
      name: "funnel_stage",
      score: funnelStageScore(profile.funnelStage),
      weight: 0.15,
      description: `Etapa: ${profile.funnelStage}`,
    },
  ];

  const score = Math.round(
    factors.reduce((sum, f) => sum + f.score * f.weight, 0)
  );

  return {
    score: Math.min(100, Math.max(0, score)),
    factors,
    riskLevel: getRiskLevel(score),
  };
}

// ============================================================
// Batch computation
// ============================================================

export async function computeAllChurnScores(db: DB): Promise<void> {
  const allContacts = await (db as any).query.contacts.findMany({
    where: eq(contacts.isArchived, false),
    columns: { id: true, creatorId: true, lastInteractionAt: true },
    with: {
      profile: {
        columns: {
          engagementLevel: true,
          funnelStage: true,
          scoringHistory: true,
          behavioralSignals: true,
          churnScore: true,
        },
      },
    },
  });

  const alertsByCreator = new Map<string, { name: string; score: number; stage: string }[]>();

  for (const contact of allContacts) {
    if (!contact.profile) continue;

    const prevScore = contact.profile.churnScore;
    const result = calculateChurnScore(
      contact.profile.behavioralSignals as BehavioralSignals | null,
      contact.profile,
      contact
    );

    await (db as any)
      .update(contactProfiles)
      .set({
        churnScore: result.score,
        churnFactors: result.factors,
        churnUpdatedAt: new Date(),
      })
      .where(eq(contactProfiles.contactId, contact.id));

    // Alert when VIP/buyer crosses into high or critical
    const wasLow = prevScore < 50;
    const isHigh = result.score >= 50;
    if (wasLow && isHigh && ["vip", "buyer", "hot_lead"].includes(contact.profile.funnelStage)) {
      const displayName = (contact as any).displayName || (contact as any).username || "Contacto";

      await (db as any).insert(notifications).values({
        creatorId: contact.creatorId,
        contactId: contact.id,
        type: "churn_risk",
        title: `${displayName} en riesgo de churn (${result.score}%)`,
        message: `${displayName} (${contact.profile.funnelStage}) tiene un score de churn de ${result.score}%. Recomendamos contactar pronto.`,
        data: { churnScore: result.score, riskLevel: result.riskLevel },
      });

      if (!alertsByCreator.has(contact.creatorId)) {
        alertsByCreator.set(contact.creatorId, []);
      }
      alertsByCreator.get(contact.creatorId)!.push({
        name: displayName,
        score: result.score,
        stage: contact.profile.funnelStage,
      });
    }
  }

  // Send churn alert emails
  for (const [creatorId, alertContacts] of alertsByCreator) {
    try {
      const creator = await (db as any).query.creators.findFirst({
        where: eq(creators.id, creatorId),
        columns: { email: true, name: true, emailNotificationsEnabled: true },
      });

      if (creator?.emailNotificationsEnabled) {
        await emailQueue.add(`churn-alert-${creatorId}`, {
          type: "churn_alert",
          to: creator.email,
          data: {
            creatorName: creator.name,
            contacts: alertContacts,
          },
        });
      }
    } catch (err) {
      log.error({ err, creatorId }, "Failed to enqueue churn alert email");
    }
  }

  log.info({ totalProcessed: allContacts.length, alertCreators: alertsByCreator.size }, "Batch churn scores computed");
}

// ============================================================
// Suggested actions
// ============================================================

const STAGE_ACTIONS: Record<string, string[]> = {
  vip: [
    "Enviar contenido exclusivo personalizado",
    "Preguntar directamente si todo esta bien",
    "Ofrecer descuento en proxima compra",
  ],
  buyer: [
    "Compartir preview de contenido nuevo",
    "Agradecer su apoyo reciente",
    "Preguntar que tipo de contenido quiere ver",
  ],
  hot_lead: [
    "Enviar mensaje casual y amigable",
    "Compartir contenido gratuito para re-enganchar",
    "Ofrecer trial de contenido premium",
  ],
  interested: [
    "Iniciar conversacion sobre sus intereses",
    "Compartir contenido relevante",
    "Hacer pregunta abierta",
  ],
  curious: [
    "Enviar mensaje de bienvenida personalizado",
    "Compartir tu mejor contenido gratuito",
    "Preguntar que le interesa",
  ],
  cold: [
    "Enviar mensaje breve y casual",
    "Compartir novedad o actualizacion",
    "No invertir demasiado esfuerzo",
  ],
};

export function getSuggestedActions(funnelStage: string): string[] {
  return STAGE_ACTIONS[funnelStage] ?? STAGE_ACTIONS.cold;
}
