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

export function calculateScores(
  rawSignals: BehavioralSignals | Record<string, unknown>,
  currentFunnelStage?: string
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

  const factors: { label: string; value: number; weight: number }[] = [];

  // --- Engagement Level ---
  // Frequency (0-100): based on message count
  const frequencyScore = clamp(Math.min(signals.messageCount / 30, 1) * 100, 0, 100);
  factors.push({ label: "Frecuencia de mensajes", value: frequencyScore, weight: 0.25 });

  // Message length (0-100)
  const lengthScore = clamp(Math.min(signals.avgMessageLength / 200, 1) * 100, 0, 100);
  factors.push({ label: "Longitud de mensajes", value: lengthScore, weight: 0.15 });

  // Sentiment (0-100): map -1..1 to 0..100
  const sentimentScore = clamp((signals.avgSentiment + 1) / 2 * 100, 0, 100);
  factors.push({ label: "Sentimiento", value: sentimentScore, weight: 0.20 });

  // Conversation depth (0-100): messages per conversation
  const msgsPerConv = signals.conversationCount > 0
    ? signals.messageCount / signals.conversationCount
    : 0;
  const depthScore = clamp(Math.min(msgsPerConv / 15, 1) * 100, 0, 100);
  factors.push({ label: "Profundidad de conversación", value: depthScore, weight: 0.15 });

  // Recency (0-100)
  let recencyScore = 0;
  if (signals.lastMessageAt) {
    const hoursSince = (Date.now() - new Date(signals.lastMessageAt).getTime()) / (1000 * 60 * 60);
    recencyScore = clamp((1 - hoursSince / 168) * 100, 0, 100); // 168h = 1 week
  }
  factors.push({ label: "Recencia", value: recencyScore, weight: 0.15 });

  // Conversations count (0-100)
  const convScore = clamp(Math.min(signals.conversationCount / 5, 1) * 100, 0, 100);
  factors.push({ label: "Conversaciones totales", value: convScore, weight: 0.10 });

  const engagementLevel = Math.round(
    frequencyScore * 0.25 +
    lengthScore * 0.15 +
    sentimentScore * 0.20 +
    depthScore * 0.15 +
    recencyScore * 0.15 +
    convScore * 0.10
  );

  // --- Payment Probability ---
  const intentScore = clamp(signals.avgPurchaseIntent * 100, 0, 100);
  const budgetScore = clamp(Math.min(signals.budgetMentions.length / 3, 1) * 100, 0, 100);
  const momentumScore = clamp(
    (signals.maxPurchaseIntent * 0.6 + (signals.sentimentTrend > 0 ? signals.sentimentTrend : 0) * 0.4) * 100,
    0, 100
  );

  const paymentProbability = Math.round(
    intentScore * 0.30 +
    budgetScore * 0.20 +
    clamp(engagementLevel, 0, 100) * 0.20 +
    momentumScore * 0.15 +
    sentimentScore * 0.15
  );

  // --- Funnel Stage (only advance, never retreat) ---
  let funnelStage: typeof FUNNEL_ORDER[number] = "cold";
  if (paymentProbability >= 85) funnelStage = "vip";
  else if (paymentProbability >= 70) funnelStage = "buyer";
  else if (paymentProbability >= 50) funnelStage = "hot_lead";
  else if (paymentProbability >= 30) funnelStage = "interested";
  else if (engagementLevel >= 20 || signals.messageCount >= 3) funnelStage = "curious";

  // Only advance: compare with current stage
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
