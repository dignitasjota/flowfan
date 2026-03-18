import { eq } from "drizzle-orm";
import type { SentimentResult } from "./ai-analysis";
import { updateSignals, calculateScores, type BehavioralSignals } from "./scoring";
import { contactProfiles, messages, contacts, notifications } from "@/server/db/schema";
import { workflowQueue } from "@/server/queues";
import { createChildLogger } from "@/lib/logger";

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

export async function updateContactProfile(
  db: DB,
  contactId: string,
  messageId: string,
  analysis: SentimentResult,
  creatorId?: string
): Promise<void> {
  try {
    // 1. Read current profile
    const profile = await (db as any).query.contactProfiles.findFirst({
      where: eq(contactProfiles.contactId, contactId),
    });

    if (!profile) return;

    // 2. Get contact info for conversation count
    const contact = await (db as any).query.contacts.findFirst({
      where: eq(contacts.id, contactId),
    });

    const prevEngagement = profile.engagementLevel;
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

    // 4. Calculate scores
    const scores = calculateScores(newSignals, profile.funnelStage);

    // 5. Build scoring history snapshot (max 50)
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

    // 6. Update contact profile
    await (db as any)
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
        updatedAt: new Date(),
      })
      .where(eq(contactProfiles.contactId, contactId));

    // 7. Update message sentiment
    await (db as any)
      .update(messages)
      .set({
        sentiment: {
          score: analysis.score,
          label: analysis.label,
          emotionalTone: analysis.emotionalTone,
          topics: analysis.topics,
          purchaseIntent: analysis.purchaseIntent,
          budgetMentions: analysis.budgetMentions,
          keyPhrases: analysis.keyPhrases,
        },
      })
      .where(eq(messages.id, messageId));

    // 8. Create notifications for significant changes
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

      // Dispatch workflow event for significant sentiment change
      const sentimentDelta = analysis.score - (prevEngagement / 100);
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
