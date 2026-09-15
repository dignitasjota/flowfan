import { eq, and } from "drizzle-orm";
import type { SentimentResult } from "./ai-analysis";
import { updateSignals, calculateScores, type BehavioralSignals, type ScoringConfig } from "./scoring";
import { calculateChurnScore } from "./churn-prediction";
import { contactProfiles, messages, contacts, notifications, platformScoringConfigs, socialComments } from "@/server/db/schema";
import { workflowQueue } from "@/server/queues";
import { createChildLogger } from "@/lib/logger";
import { publishEvent } from "@/lib/redis-pubsub";
import { dispatchWebhookEvent } from "./webhook-dispatcher";
import { findContactExperiment, recordExperimentMetric } from "./ab-experiment";
import { markExperimentConversionForContact } from "./message-experiment";

const log = createChildLogger("profile-updater");

type DB = Parameters<Parameters<typeof import("@/server/db").db.transaction>[0]>[0] | typeof import("@/server/db").db;

const FUNNEL_LABELS: Record<string, string> = {
  cold: "Frio",
  curious: "Curioso",
  interested: "Interesado",
  hot_lead: "Comprador potencial",
  buyer: "Comprador",
  vip: "VIP",
};

export type AnalysisTarget =
  | { type: "message"; id: string }
  | { type: "comment"; id: string };

export async function updateContactProfile(
  db: DB,
  contactId: string,
  messageOrTarget: string | AnalysisTarget,
  analysis: SentimentResult,
  creatorId?: string
): Promise<void> {
  const target: AnalysisTarget =
    typeof messageOrTarget === "string"
      ? { type: "message", id: messageOrTarget }
      : messageOrTarget;
  try {
    // WK-10: todo el read-modify-write del profile (leer signals/historial,
    // calcular scores, escribir) va dentro de una transacción con
    // `SELECT ... FOR UPDATE`. Sin esto, dos análisis concurrentes del mismo
    // contacto (el worker de análisis corre con concurrency 5) leen el mismo
    // `profile` antes de que ninguno escriba → lost update: `messageCount`
    // infracontado, entradas de `scoringHistory` perdidas. El lock de fila
    // serializa las transacciones sobre el mismo `contactId`: la segunda
    // espera a que la primera confirme y relee el estado ya actualizado.
    const txResult = await (db as any).transaction(async (tx: any) => {
      // 1. Read current profile (con lock de fila)
      const [profile] = await tx
        .select()
        .from(contactProfiles)
        .where(eq(contactProfiles.contactId, contactId))
        .for("update");

      if (!profile) return null;

      // 2. Get contact info for conversation count
      const contact = await tx.query.contacts.findFirst({
        where: eq(contacts.id, contactId),
      });

      const prevPayment = profile.paymentProbability;
      const prevFunnel = profile.funnelStage;

      // Calculate time since last message
      const currentSignals = profile.behavioralSignals as BehavioralSignals | null;
      let timeSinceLastMsg: number | null = null;
      if (currentSignals?.lastMessageAt) {
        timeSinceLastMsg = (Date.now() - new Date(currentSignals.lastMessageAt).getTime()) / (1000 * 60);
      }

      // 3. Update signals
      const newSignals = updateSignals(
        currentSignals,
        analysis,
        analysis.keyPhrases.join(" ").length + 50,
        timeSinceLastMsg,
        contact?.totalConversations ?? 1
      );

      // 4. Load platform scoring config (if any)
      let scoringConfig: ScoringConfig | undefined;
      const resolvedCreatorId2 = creatorId ?? contact?.creatorId;
      if (resolvedCreatorId2 && contact?.platformType) {
        const platformConfig = await tx.query.platformScoringConfigs.findFirst({
          where: and(
            eq(platformScoringConfigs.creatorId, resolvedCreatorId2),
            eq(platformScoringConfigs.platformType, contact.platformType)
          ),
        });
        if (platformConfig) {
          scoringConfig = {
            engagementWeights: platformConfig.engagementWeights as ScoringConfig["engagementWeights"],
            paymentWeights: platformConfig.paymentWeights as ScoringConfig["paymentWeights"],
            benchmarks: platformConfig.benchmarks as ScoringConfig["benchmarks"],
            funnelThresholds: platformConfig.funnelThresholds as ScoringConfig["funnelThresholds"],
            contactAgeFactor: platformConfig.contactAgeFactor as ScoringConfig["contactAgeFactor"],
          };
        }
      }

      // 5. Calculate scores
      const scores = calculateScores(
        newSignals,
        profile.funnelStage,
        scoringConfig,
        contact?.platformType,
        contact?.firstInteractionAt ? new Date(contact.firstInteractionAt) : undefined
      );

      // 6. Build scoring history snapshot (max 50)
      const history = Array.isArray(profile.scoringHistory) ? [...profile.scoringHistory] : [];
      history.push({
        timestamp: new Date().toISOString(),
        engagementLevel: scores.engagementLevel,
        paymentProbability: scores.paymentProbability,
        funnelStage: scores.funnelStage,
        sentiment: analysis.score,
      });
      if (history.length > 50) {
        history.splice(0, history.length - 50);
      }

      // 7. Calculate churn score
      const churnResult = calculateChurnScore(
        newSignals,
        { engagementLevel: scores.engagementLevel, funnelStage: scores.funnelStage, scoringHistory: history },
        { lastInteractionAt: new Date() } // Just received a message, so active now
      );

      // 8. Update contact profile
      await tx
        .update(contactProfiles)
        .set({
          engagementLevel: scores.engagementLevel,
          paymentProbability: scores.paymentProbability,
          funnelStage: scores.funnelStage,
          responseSpeed: scores.responseSpeed,
          conversationDepth: scores.conversationDepth,
          estimatedBudget: scores.estimatedBudget,
          behavioralSignals: newSignals,
          scoringHistory: history,
          churnScore: churnResult.score,
          churnFactors: churnResult.factors,
          churnUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(contactProfiles.contactId, contactId));

      return { contact, prevPayment, prevFunnel, scores, currentSignals };
    });

    if (!txResult) return;
    const { contact, prevPayment, prevFunnel, scores, currentSignals } = txResult;

    // 9. Update sentiment on message OR comment (fuera de la transacción: se
    // localiza por message/comment id, sin riesgo de lost-update sobre el
    // profile, así que no hace falta mantener el lock de fila abierto).
    const sentimentPayload = {
      score: analysis.score,
      label: analysis.label,
      emotionalTone: analysis.emotionalTone,
      topics: analysis.topics,
      purchaseIntent: analysis.purchaseIntent,
      budgetMentions: analysis.budgetMentions,
      keyPhrases: analysis.keyPhrases,
    };
    if (target.type === "message") {
      await (db as any)
        .update(messages)
        .set({ sentiment: sentimentPayload })
        .where(eq(messages.id, target.id));
    } else {
      await (db as any)
        .update(socialComments)
        .set({ sentiment: sentimentPayload })
        .where(eq(socialComments.id, target.id));
    }

    // 10. Create notifications for significant changes
    const resolvedCreatorId = creatorId ?? contact?.creatorId;
    if (resolvedCreatorId) {
      const username = contact?.displayName || contact?.username || "Contacto";

      // Payment probability spike (>15 points increase)
      if (scores.paymentProbability - prevPayment >= 15) {
        await (db as any).insert(notifications).values({
          creatorId: resolvedCreatorId,
          contactId,
          type: "payment_probability_spike",
          title: `${username} sube a ${scores.paymentProbability}% de pago`,
          message: `La probabilidad de pago de ${username} subio de ${prevPayment}% a ${scores.paymentProbability}%.`,
          data: { from: prevPayment, to: scores.paymentProbability },
        });
        publishEvent(resolvedCreatorId, {
          type: "notification",
          data: { contactId, notificationType: "payment_probability_spike" },
        }).catch(() => {});
      }

      // Funnel stage advance
      if (scores.funnelStage !== prevFunnel) {
        await (db as any).insert(notifications).values({
          creatorId: resolvedCreatorId,
          contactId,
          type: "funnel_advance",
          title: `${username} avanzo a ${FUNNEL_LABELS[scores.funnelStage] ?? scores.funnelStage}`,
          message: `${username} paso de ${FUNNEL_LABELS[prevFunnel] ?? prevFunnel} a ${FUNNEL_LABELS[scores.funnelStage] ?? scores.funnelStage}.`,
          data: { from: prevFunnel, to: scores.funnelStage },
        });
        publishEvent(resolvedCreatorId, {
          type: "notification",
          data: { contactId, notificationType: "funnel_advance" },
        }).catch(() => {});

        // Dispatch workflow event for funnel change
        try {
          await workflowQueue.add("funnel_stage_change", {
            type: "funnel_stage_change",
            creatorId: resolvedCreatorId,
            contactId,
            previousStage: prevFunnel,
            newStage: scores.funnelStage,
          });
        } catch (e) {
          log.warn({ err: e }, "Failed to enqueue funnel_stage_change workflow event");
        }
      }

      // Dispatch webhook: contact.updated
      dispatchWebhookEvent(db, resolvedCreatorId, "contact.updated", {
        contactId,
        engagementLevel: scores.engagementLevel,
        paymentProbability: scores.paymentProbability,
        funnelStage: scores.funnelStage,
      }).catch(() => {});

      // Dispatch webhook: funnel_stage.changed
      if (scores.funnelStage !== prevFunnel) {
        dispatchWebhookEvent(db, resolvedCreatorId, "funnel_stage.changed", {
          contactId,
          previousStage: prevFunnel,
          newStage: scores.funnelStage,
        }).catch(() => {});
      }

      // Record A/B experiment metrics if contact is enrolled
      try {
        const experiment = await findContactExperiment(db, contactId);
        if (experiment) {
          await recordExperimentMetric(
            db,
            experiment.experimentId,
            contactId,
            experiment.variant,
            "fan_replied"
          );
          if (scores.funnelStage !== prevFunnel) {
            await recordExperimentMetric(
              db,
              experiment.experimentId,
              contactId,
              experiment.variant,
              "conversion"
            );
          }
        }
      } catch {
        // Non-critical: don't break profile update
      }

      // A/B de mensajes: al avanzar de funnel, marca la conversión del send.
      if (scores.funnelStage !== prevFunnel && resolvedCreatorId) {
        try {
          await markExperimentConversionForContact(db, resolvedCreatorId, contactId);
        } catch {
          // Non-critical
        }
      }

      // Dispatch workflow event for significant sentiment change.
      // WK-10: comparar sentimiento NUEVO vs sentimiento PREVIO (ambos en −1..1).
      // Antes se restaba engagement normalizado (0..1), que no es un sentimiento,
      // así que casi cualquier mensaje disparaba el workflow espuriamente.
      const prevSentiment = currentSignals?.avgSentiment ?? 0;
      const sentimentDelta = analysis.score - prevSentiment;
      if (Math.abs(sentimentDelta) >= 0.2) {
        try {
          await workflowQueue.add("sentiment_change", {
            type: "sentiment_change",
            creatorId: resolvedCreatorId,
            contactId,
            conversationId: "",
            direction: sentimentDelta > 0 ? "positive" : "negative",
            delta: Math.abs(sentimentDelta),
          });
        } catch (e) {
          log.warn({ err: e }, "Failed to enqueue sentiment_change workflow event");
        }
      }
    }
  } catch (error) {
    log.error({ err: error }, "Error updating contact profile");
    throw error;
  }
}
