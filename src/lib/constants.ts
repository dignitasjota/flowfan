import { z } from "zod";

// ============================================================
// Platform types — single source of truth
// ============================================================

export const PLATFORM_TYPES = [
  "instagram",
  "tinder",
  "reddit",
  "onlyfans",
  "twitter",
  "telegram",
  "snapchat",
  "other",
] as const;

export type PlatformType = (typeof PLATFORM_TYPES)[number];

export const platformTypeSchema = z.enum(PLATFORM_TYPES);

export const PLATFORM_LABELS: Record<PlatformType, string> = {
  instagram: "Instagram",
  tinder: "Tinder",
  reddit: "Reddit",
  onlyfans: "OnlyFans",
  twitter: "Twitter",
  telegram: "Telegram",
  snapchat: "Snapchat",
  other: "Otra",
};

export const PLATFORM_OPTIONS = PLATFORM_TYPES.map((value) => ({
  value,
  label: PLATFORM_LABELS[value],
}));

// ============================================================
// Funnel stages
// ============================================================

export const FUNNEL_STAGES = [
  "cold",
  "curious",
  "interested",
  "hot_lead",
  "buyer",
  "vip",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const funnelStageSchema = z.enum(FUNNEL_STAGES);
