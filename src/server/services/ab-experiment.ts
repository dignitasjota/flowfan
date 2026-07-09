import { eq, and } from "drizzle-orm";
import { createHash } from "crypto";
import {
  conversationModeExperiments,
  experimentAssignments,
  experimentMetrics,
} from "@/server/db/schema";
import { twoProportionConfidence } from "./ab-stats";
import type { ConversationMode } from "./conversation-mode-resolver";

type DB = Parameters<typeof eq>[0] extends infer T ? any : any;

// ============================================================
// Deterministic assignment
// ============================================================

function hashToVariant(
  experimentId: string,
  contactId: string,
  trafficSplit: number
): "A" | "B" {
  const hash = createHash("sha256")
    .update(`${experimentId}:${contactId}`)
    .digest();
  const value = hash.readUInt32BE(0) % 100;
  return value < trafficSplit ? "B" : "A";
}

// ============================================================
// Assignment
// ============================================================

export async function assignContactToVariant(
  db: any,
  experimentId: string,
  contactId: string,
  trafficSplit: number
): Promise<"A" | "B"> {
  // Check existing assignment
  const existing = await db.query.experimentAssignments.findFirst({
    where: and(
      eq(experimentAssignments.experimentId, experimentId),
      eq(experimentAssignments.contactId, contactId)
    ),
  });

  if (existing) {
    return existing.variant as "A" | "B";
  }

  // Deterministic assignment
  const variant = hashToVariant(experimentId, contactId, trafficSplit);

  await db
    .insert(experimentAssignments)
    .values({ experimentId, contactId, variant })
    .onConflictDoNothing();

  return variant;
}

// ============================================================
// Get experiment mode config for a contact
// ============================================================

export async function getExperimentModeConfig(
  db: any,
  creatorId: string,
  modeType: string,
  contactId: string
): Promise<{ config: Record<string, unknown>; experimentId: string; variant: "A" | "B" } | null> {
  const experiment = await db.query.conversationModeExperiments.findFirst({
    where: and(
      eq(conversationModeExperiments.creatorId, creatorId),
      eq(conversationModeExperiments.modeType, modeType as any),
      eq(conversationModeExperiments.status, "running")
    ),
  });

  if (!experiment) return null;

  const variant = await assignContactToVariant(
    db,
    experiment.id,
    contactId,
    experiment.trafficSplit
  );

  const config =
    variant === "A"
      ? (experiment.variantAConfig as Record<string, unknown>)
      : (experiment.variantBConfig as Record<string, unknown>);

  return { config, experimentId: experiment.id, variant };
}

// ============================================================
// Record metrics
// ============================================================

export async function recordExperimentMetric(
  db: any,
  experimentId: string,
  contactId: string,
  variant: "A" | "B",
  metricType: string,
  value: number = 1
): Promise<void> {
  await db.insert(experimentMetrics).values({
    experimentId,
    contactId,
    variant,
    metricType,
    value,
  });
}

// ============================================================
// Find experiment assignment for a contact
// ============================================================

export async function findContactExperiment(
  db: any,
  contactId: string
): Promise<{ experimentId: string; variant: "A" | "B" } | null> {
  const assignment = await db.query.experimentAssignments.findFirst({
    where: eq(experimentAssignments.contactId, contactId),
    with: { experiment: true },
  });

  if (!assignment || assignment.experiment.status !== "running") return null;

  return {
    experimentId: assignment.experimentId,
    variant: assignment.variant as "A" | "B",
  };
}

// ============================================================
// Calculate experiment results
// ============================================================

export type ExperimentResults = {
  variantA: VariantMetrics;
  variantB: VariantMetrics;
  confidence: number;
  suggestedWinner: "A" | "B" | null;
};

type VariantMetrics = {
  totalContacts: number;
  responseSent: number;
  fanReplied: number;
  conversions: number;
  tipsReceived: number;
  replyRate: number;
  conversionRate: number;
};

export async function calculateExperimentResults(
  db: any,
  experimentId: string
): Promise<ExperimentResults> {
  // Count assignments per variant
  const assignments = await db.query.experimentAssignments.findMany({
    where: eq(experimentAssignments.experimentId, experimentId),
  });

  const aContacts = assignments.filter((a: any) => a.variant === "A").length;
  const bContacts = assignments.filter((a: any) => a.variant === "B").length;

  // Aggregate metrics
  const metrics = await db.query.experimentMetrics.findMany({
    where: eq(experimentMetrics.experimentId, experimentId),
  });

  function sumMetric(variant: string, type: string): number {
    return metrics
      .filter((m: any) => m.variant === variant && m.metricType === type)
      .reduce((acc: number, m: any) => acc + (m.value ?? 1), 0);
  }

  const variantA: VariantMetrics = {
    totalContacts: aContacts,
    responseSent: sumMetric("A", "response_sent"),
    fanReplied: sumMetric("A", "fan_replied"),
    conversions: sumMetric("A", "conversion"),
    tipsReceived: sumMetric("A", "tip_received"),
    replyRate: aContacts > 0 ? sumMetric("A", "fan_replied") / aContacts : 0,
    conversionRate: aContacts > 0 ? sumMetric("A", "conversion") / aContacts : 0,
  };

  const variantB: VariantMetrics = {
    totalContacts: bContacts,
    responseSent: sumMetric("B", "response_sent"),
    fanReplied: sumMetric("B", "fan_replied"),
    conversions: sumMetric("B", "conversion"),
    tipsReceived: sumMetric("B", "tip_received"),
    replyRate: bContacts > 0 ? sumMetric("B", "fan_replied") / bContacts : 0,
    conversionRate: bContacts > 0 ? sumMetric("B", "conversion") / bContacts : 0,
  };

  // Simple z-test for conversion rate difference
  const confidence = calculateConfidence(variantA, variantB);

  let suggestedWinner: "A" | "B" | null = null;
  if (confidence >= 0.95) {
    suggestedWinner =
      variantA.conversionRate > variantB.conversionRate ? "A" : "B";
  }

  return { variantA, variantB, confidence, suggestedWinner };
}

function calculateConfidence(a: VariantMetrics, b: VariantMetrics): number {
  return twoProportionConfidence(
    a.totalContacts,
    a.conversionRate,
    b.totalContacts,
    b.conversionRate
  );
}
