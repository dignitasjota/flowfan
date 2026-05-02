import { eq, and, gte, count } from "drizzle-orm";
import { type AIConfig, callAIProvider, stripThinkingBlocks } from "./ai";
import { getLanguageInstruction } from "./language-utils";
import { contacts, contactProfiles, messages, conversations } from "@/server/db/schema";
import type { BehavioralSignals } from "./scoring";

// ============================================================
// Types
// ============================================================

export type TopicGap = {
  topic: string;
  frequency: number;
  avgSentiment: number;
  sampleQuotes: string[];
};

export type DropPoint = {
  pattern: string;
  frequency: number;
  suggestion: string;
};

export type ContentOpportunity = {
  title: string;
  description: string;
  estimatedDemand: "high" | "medium" | "low";
  estimatedRevenue: "high" | "medium" | "low";
};

export type PlatformInsight = {
  platform: string;
  topTopics: string[];
  avgEngagement: number;
};

export type ContentGapReport = {
  topRequestedTopics: TopicGap[];
  engagementDropPoints: DropPoint[];
  contentOpportunities: ContentOpportunity[];
  platformBreakdown: PlatformInsight[];
  trendingThemes: string[];
  summary: string;
  tokensUsed: number;
};

export type AggregatedData = {
  topicFrequencies: Record<string, number>;
  topicSentiments: Record<string, number[]>;
  platformStats: Record<string, { contacts: number; avgEngagement: number; topTopics: string[] }>;
  engagementDropCount: number;
  totalContacts: number;
  totalMessages: number;
};

// ============================================================
// Phase 1: Aggregation (no AI)
// ============================================================

export async function aggregateConversationData(
  db: any,
  creatorId: string,
  periodDays: number
): Promise<AggregatedData> {
  const since = new Date();
  since.setDate(since.getDate() - periodDays);

  // Get all contacts with profiles
  const contactsWithProfiles = await db.query.contacts.findMany({
    where: eq(contacts.creatorId, creatorId),
    with: { profile: true },
  });

  const topicFrequencies: Record<string, number> = {};
  const topicSentiments: Record<string, number[]> = {};
  const platformStats: Record<string, { contacts: number; totalEngagement: number; topicCounts: Record<string, number> }> = {};
  let engagementDropCount = 0;

  for (const contact of contactsWithProfiles) {
    const profile = contact.profile;
    if (!profile) continue;

    const signals = profile.behavioralSignals as BehavioralSignals | null;

    // Aggregate topic frequencies
    if (signals?.topicFrequency) {
      for (const [topic, freq] of Object.entries(signals.topicFrequency)) {
        topicFrequencies[topic] = (topicFrequencies[topic] ?? 0) + freq;
        if (signals.sentimentTrend !== undefined) {
          if (!topicSentiments[topic]) topicSentiments[topic] = [];
          topicSentiments[topic].push(signals.sentimentTrend);
        }
      }
    }

    // Platform stats
    const platform = contact.platformType;
    if (!platformStats[platform]) {
      platformStats[platform] = { contacts: 0, totalEngagement: 0, topicCounts: {} };
    }
    platformStats[platform].contacts += 1;
    platformStats[platform].totalEngagement += profile.engagementLevel ?? 0;

    if (signals?.topicFrequency) {
      for (const [topic, freq] of Object.entries(signals.topicFrequency)) {
        platformStats[platform].topicCounts[topic] =
          (platformStats[platform].topicCounts[topic] ?? 0) + freq;
      }
    }

    // Detect engagement drops via scoring history
    const history = profile.scoringHistory as { engagement?: number[] } | null;
    if (history?.engagement && history.engagement.length >= 3) {
      const recent = history.engagement.slice(-3);
      if (recent[2]! < recent[0]! * 0.7) {
        engagementDropCount += 1;
      }
    }
  }

  // Count total messages in period
  const [msgCount] = await db
    .select({ count: count() })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.creatorId, creatorId),
        gte(messages.createdAt, since)
      )
    );

  // Build platform breakdown
  const platformResult: Record<string, { contacts: number; avgEngagement: number; topTopics: string[] }> = {};
  for (const [platform, stats] of Object.entries(platformStats)) {
    const topTopics = Object.entries(stats.topicCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([t]) => t);
    platformResult[platform] = {
      contacts: stats.contacts,
      avgEngagement: stats.contacts > 0 ? Math.round(stats.totalEngagement / stats.contacts) : 0,
      topTopics,
    };
  }

  return {
    topicFrequencies,
    topicSentiments,
    platformStats: platformResult,
    engagementDropCount,
    totalContacts: contactsWithProfiles.length,
    totalMessages: msgCount?.count ?? 0,
  };
}

// ============================================================
// Get topic trends (no AI, free)
// ============================================================

export async function getTopicTrends(
  db: any,
  creatorId: string
): Promise<{ topic: string; frequency: number; avgSentiment: number }[]> {
  const contactsWithProfiles = await db.query.contacts.findMany({
    where: eq(contacts.creatorId, creatorId),
    with: { profile: { columns: { behavioralSignals: true } } },
  });

  const topicFreqs: Record<string, number> = {};
  const topicSentiments: Record<string, number[]> = {};

  for (const contact of contactsWithProfiles) {
    const signals = contact.profile?.behavioralSignals as BehavioralSignals | null;
    if (!signals?.topicFrequency) continue;

    for (const [topic, freq] of Object.entries(signals.topicFrequency)) {
      topicFreqs[topic] = (topicFreqs[topic] ?? 0) + freq;
      if (signals.sentimentTrend !== undefined) {
        if (!topicSentiments[topic]) topicSentiments[topic] = [];
        topicSentiments[topic].push(signals.sentimentTrend);
      }
    }
  }

  return Object.entries(topicFreqs)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .map(([topic, frequency]) => {
      const sentiments = topicSentiments[topic] ?? [];
      const avgSentiment =
        sentiments.length > 0
          ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length
          : 0;
      return { topic, frequency, avgSentiment: Math.round(avgSentiment * 100) / 100 };
    });
}

// ============================================================
// Phase 2: AI Analysis
// ============================================================

const CONTENT_GAP_PROMPT = `Eres un analista de contenido para creadores digitales.
Analiza los datos agregados de conversaciones e identifica gaps de contenido.
Responde SOLO con un JSON valido (sin markdown, sin explicaciones):

{
  "topRequestedTopics": [
    {
      "topic": <string>,
      "frequency": <number>,
      "avgSentiment": <number -1 a 1>,
      "sampleQuotes": [<string, 2-3 frases tipicas sobre este tema>]
    }
  ],
  "engagementDropPoints": [
    {
      "pattern": <string, patron donde se pierde engagement>,
      "frequency": <number, cuantos contactos afectados>,
      "suggestion": <string, que hacer diferente>
    }
  ],
  "contentOpportunities": [
    {
      "title": <string>,
      "description": <string>,
      "estimatedDemand": <"high" | "medium" | "low">,
      "estimatedRevenue": <"high" | "medium" | "low">
    }
  ],
  "platformBreakdown": [
    {
      "platform": <string>,
      "topTopics": [<string>],
      "avgEngagement": <number>
    }
  ],
  "trendingThemes": [<string, 3-5 temas emergentes>],
  "summary": <string, resumen ejecutivo de 3-4 frases>
}

Maximo 10 topRequestedTopics, 5 engagementDropPoints, 5 contentOpportunities.
Responde UNICAMENTE con el JSON.`;

function parseContentGapJSON(text: string): Omit<ContentGapReport, "tokensUsed"> | null {
  let cleaned = stripThinkingBlocks(text);
  cleaned = cleaned.replace(/```json\s*/gi, "").replace(/```\s*/gi, "");

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    return {
      topRequestedTopics: Array.isArray(parsed.topRequestedTopics)
        ? parsed.topRequestedTopics.slice(0, 10).map((t: any) => ({
            topic: String(t.topic || ""),
            frequency: Number(t.frequency) || 0,
            avgSentiment: Math.max(-1, Math.min(1, Number(t.avgSentiment) || 0)),
            sampleQuotes: Array.isArray(t.sampleQuotes)
              ? t.sampleQuotes.map(String).slice(0, 3)
              : [],
          }))
        : [],
      engagementDropPoints: Array.isArray(parsed.engagementDropPoints)
        ? parsed.engagementDropPoints.slice(0, 5).map((d: any) => ({
            pattern: String(d.pattern || ""),
            frequency: Number(d.frequency) || 0,
            suggestion: String(d.suggestion || ""),
          }))
        : [],
      contentOpportunities: Array.isArray(parsed.contentOpportunities)
        ? parsed.contentOpportunities.slice(0, 5).map((o: any) => ({
            title: String(o.title || ""),
            description: String(o.description || ""),
            estimatedDemand: ["high", "medium", "low"].includes(o.estimatedDemand)
              ? o.estimatedDemand
              : "medium",
            estimatedRevenue: ["high", "medium", "low"].includes(o.estimatedRevenue)
              ? o.estimatedRevenue
              : "medium",
          }))
        : [],
      platformBreakdown: Array.isArray(parsed.platformBreakdown)
        ? parsed.platformBreakdown.map((p: any) => ({
            platform: String(p.platform || ""),
            topTopics: Array.isArray(p.topTopics) ? p.topTopics.map(String).slice(0, 5) : [],
            avgEngagement: Number(p.avgEngagement) || 0,
          }))
        : [],
      trendingThemes: Array.isArray(parsed.trendingThemes)
        ? parsed.trendingThemes.map(String).slice(0, 5)
        : [],
      summary: String(parsed.summary || "Sin datos suficientes para generar resumen."),
    };
  } catch {
    return null;
  }
}

export async function analyzeContentGaps(
  config: AIConfig,
  data: AggregatedData,
  language?: string
): Promise<ContentGapReport> {
  let systemPrompt = CONTENT_GAP_PROMPT;
  if (language) {
    systemPrompt += `\n\n${getLanguageInstruction(language)}`;
  }

  // Build data summary for AI
  const topTopics = Object.entries(data.topicFrequencies)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20);

  const dataSummary = [
    `Total contactos analizados: ${data.totalContacts}`,
    `Total mensajes en el periodo: ${data.totalMessages}`,
    `Contactos con caida de engagement: ${data.engagementDropCount}`,
    `\nTemas mas frecuentes (top 20):`,
    ...topTopics.map(([topic, freq]) => {
      const sentiments = data.topicSentiments[topic] ?? [];
      const avg =
        sentiments.length > 0
          ? (sentiments.reduce((a, b) => a + b, 0) / sentiments.length).toFixed(2)
          : "N/A";
      return `  - ${topic}: ${freq} menciones (sentimiento promedio: ${avg})`;
    }),
    `\nDesglose por plataforma:`,
    ...Object.entries(data.platformStats).map(
      ([platform, stats]) =>
        `  - ${platform}: ${stats.contacts} contactos, engagement promedio ${stats.avgEngagement}, temas principales: ${stats.topTopics.join(", ") || "ninguno"}`
    ),
  ];

  const result = await callAIProvider(
    config,
    systemPrompt,
    [{ role: "user", content: dataSummary.join("\n") }],
    2048
  );

  const parsed = parseContentGapJSON(result.text);

  if (!parsed) {
    return {
      topRequestedTopics: [],
      engagementDropPoints: [],
      contentOpportunities: [],
      platformBreakdown: [],
      trendingThemes: [],
      summary: "No se pudo generar el analisis de contenido.",
      tokensUsed: result.tokensUsed,
    };
  }

  return { ...parsed, tokensUsed: result.tokensUsed };
}
