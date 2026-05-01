import type { SentimentResult } from "./ai-analysis";

// ============================================================
// Types
// ============================================================

export type BehavioralSignals = {
  messageCount: number;
  avgMessageLength: number;
  avgSentiment: number;
  sentimentTrend: number; // positive = improving
  avgPurchaseIntent: number;
  maxPurchaseIntent: number;
  topicFrequency: Record<string, number>;
  budgetMentions: string[];
  lastMessageAt: string | null;
  avgTimeBetweenMessages: number; // minutes
  conversationCount: number;
};

export type ScoringResult = {
  engagementLevel: number; // 0-100
  paymentProbability: number; // 0-100
  funnelStage: "cold" | "curious" | "interested" | "hot_lead" | "buyer" | "vip";
  responseSpeed: "fast" | "medium" | "slow";
  conversationDepth: "superficial" | "moderate" | "deep";
  estimatedBudget: "low" | "medium" | "high" | "premium";
  factors: { label: string; value: number; weight: number }[];
};

// ============================================================
// Signal Accumulator
// ============================================================

const EMPTY_SIGNALS: BehavioralSignals = {
  messageCount: 0,
  avgMessageLength: 0,
  avgSentiment: 0,
  sentimentTrend: 0,
  avgPurchaseIntent: 0,
  maxPurchaseIntent: 0,
  topicFrequency: {},
  budgetMentions: [],
  lastMessageAt: null,
  avgTimeBetweenMessages: 0,
  conversationCount: 1,
};

export function updateSignals(
  current: BehavioralSignals | null | undefined,
  analysis: SentimentResult,
  messageLength: number,
  timeSinceLastMsg: number | null, // minutes
  conversationCount: number
): BehavioralSignals {
  const prev = current && typeof current === "object" && "messageCount" in current
    ? current as BehavioralSignals
    : { ...EMPTY_SIGNALS };

  const n = prev.messageCount;
  const newCount = n + 1;

  // Running averages
  const avgLen = (prev.avgMessageLength * n + messageLength) / newCount;
  const avgSent = (prev.avgSentiment * n + analysis.score) / newCount;
  const avgIntent = (prev.avgPurchaseIntent * n + analysis.purchaseIntent) / newCount;

  // Sentiment trend: compare new sentiment to running average
  const sentimentTrend = n > 2
    ? (prev.sentimentTrend * 0.7 + (analysis.score - prev.avgSentiment) * 0.3)
    : 0;

  // Topic frequency
  const topicFreq = { ...prev.topicFrequency };
  for (const topic of analysis.topics) {
    topicFreq[topic] = (topicFreq[topic] ?? 0) + 1;
  }

  // Budget mentions (deduplicate, keep last 10)
  const budgetSet = new Set([...prev.budgetMentions, ...analysis.budgetMentions]);
  const budgetMentions = [...budgetSet].slice(-10);

  // Average time between messages
  const avgTime = timeSinceLastMsg !== null && n > 0
    ? (prev.avgTimeBetweenMessages * (n - 1) + timeSinceLastMsg) / n
    : prev.avgTimeBetweenMessages;

  return {
    messageCount: newCount,
    avgMessageLength: avgLen,
    avgSentiment: avgSent,
    sentimentTrend,
    avgPurchaseIntent: avgIntent,
    maxPurchaseIntent: Math.max(prev.maxPurchaseIntent, analysis.purchaseIntent),
    topicFrequency: topicFreq,
    budgetMentions,
    lastMessageAt: new Date().toISOString(),
    avgTimeBetweenMessages: avgTime,
    conversationCount,
  };
}

// ============================================================
// Score Calculator
// ============================================================

const FUNNEL_ORDER = ["cold", "curious", "interested", "hot_lead", "buyer", "vip"] as const;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// --- Configurable types ---

export type EngagementWeights = {
  frequency: number;
  msgLength: number;
  sentiment: number;
  depth: number;
  recency: number;
  convCount: number;
};

export type PaymentWeights = {
  intent: number;
  budget: number;
  engagement: number;
  momentum: number;
  sentiment: number;
};

export type ScoringBenchmarks = {
  maxMessages: number;
  maxMsgLength: number;
  recencyHours: number;
  maxConversations: number;
  maxMsgsPerConv: number;
  maxBudgetMentions: number;
};

export type FunnelThresholds = {
  vip: number;
  buyer: number;
  hotLead: number;
  interested: number;
  curious: number;
};

export type ContactAgeFactor = {
  enabled: boolean;
  newContactDays: number;
  boostFactor: number;
};

export type ScoringConfig = {
  engagementWeights?: Partial<EngagementWeights>;
  paymentWeights?: Partial<PaymentWeights>;
  benchmarks?: Partial<ScoringBenchmarks>;
  funnelThresholds?: Partial<FunnelThresholds>;
  contactAgeFactor?: Partial<ContactAgeFactor>;
};

// --- Defaults ---

export const DEFAULT_ENGAGEMENT_WEIGHTS: EngagementWeights = {
  frequency: 0.25,
  msgLength: 0.15,
  sentiment: 0.20,
  depth: 0.15,
  recency: 0.15,
  convCount: 0.10,
};

export const DEFAULT_PAYMENT_WEIGHTS: PaymentWeights = {
  intent: 0.30,
  budget: 0.20,
  engagement: 0.20,
  momentum: 0.15,
  sentiment: 0.15,
};

export const DEFAULT_BENCHMARKS: ScoringBenchmarks = {
  maxMessages: 30,
  maxMsgLength: 200,
  recencyHours: 168,
  maxConversations: 5,
  maxMsgsPerConv: 15,
  maxBudgetMentions: 3,
};

export const DEFAULT_FUNNEL_THRESHOLDS: FunnelThresholds = {
  vip: 85,
  buyer: 70,
  hotLead: 50,
  interested: 30,
  curious: 20,
};

export const DEFAULT_CONTACT_AGE_FACTOR: ContactAgeFactor = {
  enabled: false,
  newContactDays: 14,
  boostFactor: 1.2,
};

// --- Per-platform presets ---

export const PLATFORM_SCORING_DEFAULTS: Record<string, Partial<ScoringConfig>> = {
  onlyfans: {
    benchmarks: { maxMsgLength: 100, maxMessages: 15 },
    paymentWeights: { intent: 0.35, engagement: 0.15 },
  },
  telegram: {
    benchmarks: { maxMessages: 50, recencyHours: 336 },
    engagementWeights: { convCount: 0.15, frequency: 0.20 },
  },
  twitter: {
    engagementWeights: { depth: 0.10, sentiment: 0.25 },
  },
  reddit: {
    engagementWeights: { depth: 0.10, sentiment: 0.25 },
  },
};

// --- Merge helper ---

export function mergeScoringConfig(
  platformType?: string,
  creatorOverride?: ScoringConfig | null,
): {
  ew: EngagementWeights;
  pw: PaymentWeights;
  bm: ScoringBenchmarks;
  ft: FunnelThresholds;
  af: ContactAgeFactor;
} {
  const platformDefaults = platformType ? PLATFORM_SCORING_DEFAULTS[platformType] : undefined;

  const ew: EngagementWeights = {
    ...DEFAULT_ENGAGEMENT_WEIGHTS,
    ...platformDefaults?.engagementWeights,
    ...creatorOverride?.engagementWeights,
  };

  const pw: PaymentWeights = {
    ...DEFAULT_PAYMENT_WEIGHTS,
    ...platformDefaults?.paymentWeights,
    ...creatorOverride?.paymentWeights,
  };

  const bm: ScoringBenchmarks = {
    ...DEFAULT_BENCHMARKS,
    ...platformDefaults?.benchmarks,
    ...creatorOverride?.benchmarks,
  };

  const ft: FunnelThresholds = {
    ...DEFAULT_FUNNEL_THRESHOLDS,
    ...platformDefaults?.funnelThresholds,
    ...creatorOverride?.funnelThresholds,
  };

  const af: ContactAgeFactor = {
    ...DEFAULT_CONTACT_AGE_FACTOR,
    ...creatorOverride?.contactAgeFactor,
  };

  return { ew, pw, bm, ft, af };
}

// --- Main calculator ---

export function calculateScores(
  rawSignals: BehavioralSignals | Record<string, unknown>,
  currentFunnelStage?: string,
  config?: ScoringConfig,
  platformType?: string,
  contactCreatedAt?: Date,
): ScoringResult {
  // Normalize signals to handle empty {} from DB default
  const signals: BehavioralSignals = {
    messageCount: Number(rawSignals.messageCount) || 0,
    avgMessageLength: Number(rawSignals.avgMessageLength) || 0,
    avgSentiment: Number(rawSignals.avgSentiment) || 0,
    sentimentTrend: Number(rawSignals.sentimentTrend) || 0,
    avgPurchaseIntent: Number(rawSignals.avgPurchaseIntent) || 0,
    maxPurchaseIntent: Number(rawSignals.maxPurchaseIntent) || 0,
    topicFrequency: (rawSignals.topicFrequency as Record<string, number>) ?? {},
    budgetMentions: Array.isArray(rawSignals.budgetMentions) ? rawSignals.budgetMentions : [],
    lastMessageAt: (rawSignals.lastMessageAt as string) ?? null,
    avgTimeBetweenMessages: Number(rawSignals.avgTimeBetweenMessages) || 0,
    conversationCount: Number(rawSignals.conversationCount) || 0,
  };

  const { ew, pw, bm, ft, af } = mergeScoringConfig(platformType, config);
  const factors: { label: string; value: number; weight: number }[] = [];

  // --- Engagement Level ---
  const frequencyScore = clamp(Math.min(signals.messageCount / bm.maxMessages, 1) * 100, 0, 100);
  factors.push({ label: "Frecuencia de mensajes", value: frequencyScore, weight: ew.frequency });

  const lengthScore = clamp(Math.min(signals.avgMessageLength / bm.maxMsgLength, 1) * 100, 0, 100);
  factors.push({ label: "Longitud de mensajes", value: lengthScore, weight: ew.msgLength });

  const sentimentScore = clamp((signals.avgSentiment + 1) / 2 * 100, 0, 100);
  factors.push({ label: "Sentimiento", value: sentimentScore, weight: ew.sentiment });

  const msgsPerConv = signals.conversationCount > 0
    ? signals.messageCount / signals.conversationCount
    : 0;
  const depthScore = clamp(Math.min(msgsPerConv / bm.maxMsgsPerConv, 1) * 100, 0, 100);
  factors.push({ label: "Profundidad de conversación", value: depthScore, weight: ew.depth });

  let recencyScore = 0;
  if (signals.lastMessageAt) {
    const hoursSince = (Date.now() - new Date(signals.lastMessageAt).getTime()) / (1000 * 60 * 60);
    recencyScore = clamp((1 - hoursSince / bm.recencyHours) * 100, 0, 100);
  }
  factors.push({ label: "Recencia", value: recencyScore, weight: ew.recency });

  const convScore = clamp(Math.min(signals.conversationCount / bm.maxConversations, 1) * 100, 0, 100);
  factors.push({ label: "Conversaciones totales", value: convScore, weight: ew.convCount });

  let engagementLevel = Math.round(
    frequencyScore * ew.frequency +
    lengthScore * ew.msgLength +
    sentimentScore * ew.sentiment +
    depthScore * ew.depth +
    recencyScore * ew.recency +
    convScore * ew.convCount
  );

  // Contact age factor: boost engagement for new contacts
  if (af.enabled && contactCreatedAt) {
    const daysSinceCreation = (Date.now() - contactCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCreation < af.newContactDays) {
      const scale = 1 - daysSinceCreation / af.newContactDays;
      const boost = 1 + (af.boostFactor - 1) * scale;
      engagementLevel = Math.round(engagementLevel * boost);
    }
  }

  // --- Payment Probability ---
  const intentScore = clamp(signals.avgPurchaseIntent * 100, 0, 100);
  const budgetScore = clamp(Math.min(signals.budgetMentions.length / bm.maxBudgetMentions, 1) * 100, 0, 100);
  const momentumScore = clamp(
    (signals.maxPurchaseIntent * 0.6 + (signals.sentimentTrend > 0 ? signals.sentimentTrend : 0) * 0.4) * 100,
    0, 100
  );

  const paymentProbability = Math.round(
    intentScore * pw.intent +
    budgetScore * pw.budget +
    clamp(engagementLevel, 0, 100) * pw.engagement +
    momentumScore * pw.momentum +
    sentimentScore * pw.sentiment
  );

  // --- Funnel Stage (only advance, never retreat) ---
  let funnelStage: typeof FUNNEL_ORDER[number] = "cold";
  if (paymentProbability >= ft.vip) funnelStage = "vip";
  else if (paymentProbability >= ft.buyer) funnelStage = "buyer";
  else if (paymentProbability >= ft.hotLead) funnelStage = "hot_lead";
  else if (paymentProbability >= ft.interested) funnelStage = "interested";
  else if (engagementLevel >= ft.curious || signals.messageCount >= 3) funnelStage = "curious";

  if (currentFunnelStage) {
    const currentIdx = FUNNEL_ORDER.indexOf(currentFunnelStage as typeof FUNNEL_ORDER[number]);
    const newIdx = FUNNEL_ORDER.indexOf(funnelStage);
    if (currentIdx >= 0 && currentIdx > newIdx) {
      funnelStage = currentFunnelStage as typeof FUNNEL_ORDER[number];
    }
  }

  // --- Derived enums ---
  const responseSpeed: "fast" | "medium" | "slow" =
    signals.avgTimeBetweenMessages < 30 ? "fast" :
    signals.avgTimeBetweenMessages < 120 ? "medium" : "slow";

  const conversationDepth: "superficial" | "moderate" | "deep" =
    msgsPerConv >= 10 ? "deep" :
    msgsPerConv >= 4 ? "moderate" : "superficial";

  const estimatedBudget: "low" | "medium" | "high" | "premium" =
    paymentProbability >= 80 ? "premium" :
    paymentProbability >= 55 ? "high" :
    paymentProbability >= 30 ? "medium" : "low";

  return {
    engagementLevel: clamp(engagementLevel, 0, 100),
    paymentProbability: clamp(paymentProbability, 0, 100),
    funnelStage,
    responseSpeed,
    conversationDepth,
    estimatedBudget,
    factors,
  };
}
