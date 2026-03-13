import type { BehavioralSignals } from "./scoring";

// ============================================================
// Types
// ============================================================

export type ProactiveAction = {
  type: "engage" | "offer" | "price" | "retain" | "followup";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  contactId: string;
  contactUsername: string;
  platformType: string;
};

type ContactData = {
  id: string;
  username: string;
  displayName: string | null;
  platformType: string;
  lastInteractionAt: Date;
  totalConversations: number;
  profile: {
    engagementLevel: number;
    paymentProbability: number;
    funnelStage: string;
    estimatedBudget: string | null;
    behavioralSignals: BehavioralSignals | Record<string, unknown> | null;
  } | null;
};

// ============================================================
// Action Generator
// ============================================================

export function generateProactiveActions(
  contacts: ContactData[]
): ProactiveAction[] {
  const actions: ProactiveAction[] = [];
  const now = Date.now();

  for (const contact of contacts) {
    if (!contact.profile) continue;

    const p = contact.profile;
    const signals = p.behavioralSignals as BehavioralSignals | null;
    const daysSinceLastInteraction = (now - new Date(contact.lastInteractionAt).getTime()) / (1000 * 60 * 60 * 24);
    const username = contact.displayName || contact.username;

    // 1. Inactive VIP/buyer: high priority retain
    if (
      (p.funnelStage === "vip" || p.funnelStage === "buyer") &&
      daysSinceLastInteraction > 3
    ) {
      actions.push({
        type: "retain",
        priority: "high",
        title: `${username} lleva ${Math.floor(daysSinceLastInteraction)} dias sin actividad`,
        description: `Contacto ${p.funnelStage === "vip" ? "VIP" : "comprador"} inactivo. Envia un mensaje personalizado para mantener la relacion.`,
        contactId: contact.id,
        contactUsername: contact.username,
        platformType: contact.platformType,
      });
    }

    // 2. Rising sentiment + high purchase intent: time to offer
    if (
      signals &&
      signals.sentimentTrend > 0.1 &&
      p.paymentProbability >= 40 &&
      (p.funnelStage === "interested" || p.funnelStage === "hot_lead")
    ) {
      actions.push({
        type: "offer",
        priority: "high",
        title: `Buen momento para oferta a ${username}`,
        description: `Sentimiento en alza y ${p.paymentProbability}% probabilidad de pago. Considera hacer una oferta de contenido premium.`,
        contactId: contact.id,
        contactUsername: contact.username,
        platformType: contact.platformType,
      });
    }

    // 3. Budget mentions detected: suggest price
    if (
      signals &&
      signals.budgetMentions &&
      signals.budgetMentions.length >= 2
    ) {
      actions.push({
        type: "price",
        priority: "medium",
        title: `${username} ha mencionado presupuesto ${signals.budgetMentions.length} veces`,
        description: `Ha hablado de dinero/precios. Revisa la recomendacion de precio en su perfil.`,
        contactId: contact.id,
        contactUsername: contact.username,
        platformType: contact.platformType,
      });
    }

    // 4. Curious with high engagement: nurture
    if (
      p.funnelStage === "curious" &&
      p.engagementLevel >= 40 &&
      daysSinceLastInteraction <= 7
    ) {
      actions.push({
        type: "engage",
        priority: "medium",
        title: `${username} muestra alto interes`,
        description: `Engagement ${p.engagementLevel}/100 en etapa "Curioso". Una conversacion mas podria avanzarlo a "Interesado".`,
        contactId: contact.id,
        contactUsername: contact.username,
        platformType: contact.platformType,
      });
    }

    // 5. General inactivity (any contact > 7 days)
    if (
      daysSinceLastInteraction > 7 &&
      p.engagementLevel >= 20 &&
      p.funnelStage !== "cold"
    ) {
      actions.push({
        type: "followup",
        priority: "low",
        title: `Seguimiento pendiente con ${username}`,
        description: `${Math.floor(daysSinceLastInteraction)} dias sin contacto. Engagement ${p.engagementLevel}/100.`,
        contactId: contact.id,
        contactUsername: contact.username,
        platformType: contact.platformType,
      });
    }
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return actions;
}
