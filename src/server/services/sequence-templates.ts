import type { SequenceStep } from "./sequence-engine";

export interface SequenceTemplate {
  name: string;
  description: string;
  type: "nurturing" | "followup" | "custom";
  steps: SequenceStep[];
  enrollmentCriteria: Record<string, unknown>;
}

export const FOLLOWUP_3_7_14: SequenceTemplate = {
  name: "Follow-Up 3-7-14",
  description: "Secuencia de seguimiento a los 3, 7 y 14 dias de inactividad",
  type: "followup",
  steps: [
    {
      stepNumber: 0,
      delayDays: 3,
      actionType: "send_message",
      actionConfig: {
        content: "Hey {{displayName}}! Te extrañamos por aqui 💕 ¿Como has estado?",
      },
    },
    {
      stepNumber: 1,
      delayDays: 7,
      actionType: "send_message",
      actionConfig: {
        content: "{{displayName}}, tengo contenido nuevo que creo que te va a encantar 🔥 ¿Te gustaria verlo?",
      },
    },
    {
      stepNumber: 2,
      delayDays: 14,
      actionType: "send_message",
      actionConfig: {
        content: "{{displayName}}, hace tiempo que no hablamos. Tengo algo especial preparado para ti, ¿quieres saber que es? 😏",
      },
    },
  ],
  enrollmentCriteria: {
    minDaysInactive: 3,
    funnelStages: ["interested", "hot_lead", "buyer"],
  },
};

export const NURTURING_WELCOME: SequenceTemplate = {
  name: "Nurturing - Bienvenida",
  description: "Secuencia de bienvenida: saludo, contenido gratuito, oferta premium",
  type: "nurturing",
  steps: [
    {
      stepNumber: 0,
      delayDays: 0,
      actionType: "send_message",
      actionConfig: {
        content: "Bienvenido/a {{displayName}}! 🎉 Me alegra mucho tenerte aqui. Estoy aqui para lo que necesites 💕",
      },
    },
    {
      stepNumber: 1,
      delayDays: 3,
      actionType: "send_message",
      actionConfig: {
        content: "{{displayName}}, queria compartirte algo especial para que vayas conociendo mi contenido 🔥 ¿Te interesa?",
      },
    },
    {
      stepNumber: 2,
      delayDays: 7,
      actionType: "send_message",
      actionConfig: {
        content: "{{displayName}}, ¿que te ha parecido todo hasta ahora? Tengo contenido premium exclusivo que creo que te encantaria 💎 ¿Quieres saber mas?",
      },
    },
  ],
  enrollmentCriteria: {
    triggerOnNewContact: true,
  },
};

export const ALL_TEMPLATES: SequenceTemplate[] = [FOLLOWUP_3_7_14, NURTURING_WELCOME];

export async function createDefaultSequences(
  db: any,
  creatorId: string,
): Promise<void> {
  const { sequences } = await import("@/server/db/schema");

  for (const template of ALL_TEMPLATES) {
    await db.insert(sequences).values({
      creatorId,
      name: template.name,
      description: template.description,
      type: template.type,
      steps: template.steps,
      isActive: false, // Disabled by default — creator must activate
      enrollmentCriteria: template.enrollmentCriteria,
    });
  }
}
