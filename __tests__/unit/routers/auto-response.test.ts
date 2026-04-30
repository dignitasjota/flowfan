import { describe, it, expect } from "vitest";

// ============================================================
// Helpers — test config logic and classification stats shape
// ============================================================

type ConfigFormState = {
  isEnabled: boolean;
  inactivityMinutes: number;
  useAIReply: boolean;
  maxTokens: number;
  fallbackMessage: string;
  classifyMessages: boolean;
  preGenerateReplies: boolean;
};

const DEFAULT_CONFIG: ConfigFormState = {
  isEnabled: false,
  inactivityMinutes: 30,
  useAIReply: false,
  maxTokens: 256,
  fallbackMessage: "",
  classifyMessages: true,
  preGenerateReplies: true,
};

const VALID_PLATFORMS = [
  "instagram",
  "tinder",
  "reddit",
  "onlyfans",
  "twitter",
  "telegram",
  "snapchat",
  "other",
] as const;

type PlatformType = (typeof VALID_PLATFORMS)[number];

function makeConfig(overrides: Partial<ConfigFormState> = {}): ConfigFormState {
  return { ...DEFAULT_CONFIG, ...overrides };
}

// ============================================================
// Config defaults
// ============================================================

describe("auto-response — config defaults", () => {
  it("default config has auto-response disabled", () => {
    expect(DEFAULT_CONFIG.isEnabled).toBe(false);
  });

  it("default config has AI reply disabled", () => {
    expect(DEFAULT_CONFIG.useAIReply).toBe(false);
  });

  it("default inactivity is 30 minutes", () => {
    expect(DEFAULT_CONFIG.inactivityMinutes).toBe(30);
  });

  it("default max tokens is 256", () => {
    expect(DEFAULT_CONFIG.maxTokens).toBe(256);
  });

  it("classify messages enabled by default", () => {
    expect(DEFAULT_CONFIG.classifyMessages).toBe(true);
  });

  it("pre-generate replies enabled by default", () => {
    expect(DEFAULT_CONFIG.preGenerateReplies).toBe(true);
  });
});

// ============================================================
// Config override logic
// ============================================================

describe("auto-response — config overrides", () => {
  it("overrides individual fields", () => {
    const config = makeConfig({ isEnabled: true, inactivityMinutes: 60 });
    expect(config.isEnabled).toBe(true);
    expect(config.inactivityMinutes).toBe(60);
    expect(config.useAIReply).toBe(false); // unchanged
  });

  it("enables AI reply with custom max tokens", () => {
    const config = makeConfig({ useAIReply: true, maxTokens: 512 });
    expect(config.useAIReply).toBe(true);
    expect(config.maxTokens).toBe(512);
  });

  it("sets fallback message", () => {
    const config = makeConfig({ fallbackMessage: "Gracias por tu mensaje!" });
    expect(config.fallbackMessage).toBe("Gracias por tu mensaje!");
  });
});

// ============================================================
// Platform validation
// ============================================================

describe("auto-response — platforms", () => {
  it("supports 8 platforms", () => {
    expect(VALID_PLATFORMS).toHaveLength(8);
  });

  it("includes all expected platforms", () => {
    const expected = ["instagram", "tinder", "reddit", "onlyfans", "twitter", "telegram", "snapchat", "other"];
    for (const p of expected) {
      expect(VALID_PLATFORMS).toContain(p);
    }
  });
});

// ============================================================
// Classification stats shape
// ============================================================

describe("auto-response — classification stats", () => {
  it("stats shape has all 4 categories initialized to 0", () => {
    const result: Record<string, number> = {
      urgent: 0,
      price_inquiry: 0,
      spam: 0,
      general: 0,
    };
    expect(Object.keys(result)).toHaveLength(4);
    expect(result.urgent).toBe(0);
    expect(result.price_inquiry).toBe(0);
    expect(result.spam).toBe(0);
    expect(result.general).toBe(0);
  });

  it("populates stats from row data", () => {
    const rows = [
      { category: "urgent", count: 5 },
      { category: "spam", count: 12 },
      { category: "price_inquiry", count: 3 },
    ];

    const result: Record<string, number> = {
      urgent: 0,
      price_inquiry: 0,
      spam: 0,
      general: 0,
    };

    for (const row of rows) {
      if (row.category && row.category in result) {
        result[row.category] = row.count;
      }
    }

    expect(result.urgent).toBe(5);
    expect(result.spam).toBe(12);
    expect(result.price_inquiry).toBe(3);
    expect(result.general).toBe(0);
  });

  it("ignores unknown categories", () => {
    const rows = [{ category: "unknown", count: 99 }];
    const result: Record<string, number> = {
      urgent: 0,
      price_inquiry: 0,
      spam: 0,
      general: 0,
    };

    for (const row of rows) {
      if (row.category && row.category in result) {
        result[row.category] = row.count;
      }
    }

    expect(result).toEqual({ urgent: 0, price_inquiry: 0, spam: 0, general: 0 });
  });

  it("handles null category gracefully", () => {
    const rows = [{ category: null as string | null, count: 10 }];
    const result: Record<string, number> = {
      urgent: 0,
      price_inquiry: 0,
      spam: 0,
      general: 0,
    };

    for (const row of rows) {
      if (row.category && row.category in result) {
        result[row.category] = row.count;
      }
    }

    expect(result).toEqual({ urgent: 0, price_inquiry: 0, spam: 0, general: 0 });
  });
});

// ============================================================
// Upsert logic
// ============================================================

describe("auto-response — upsert config logic", () => {
  it("toggle flips isEnabled", () => {
    const current = makeConfig({ isEnabled: false });
    const toggled = { ...current, isEnabled: !current.isEnabled };
    expect(toggled.isEnabled).toBe(true);
  });

  it("double toggle returns to original state", () => {
    const original = makeConfig({ isEnabled: true });
    const toggled = { ...original, isEnabled: !original.isEnabled };
    const doubleToggled = { ...toggled, isEnabled: !toggled.isEnabled };
    expect(doubleToggled.isEnabled).toBe(original.isEnabled);
  });

  it("preserves other fields when toggling", () => {
    const current = makeConfig({
      isEnabled: true,
      inactivityMinutes: 45,
      useAIReply: true,
      maxTokens: 512,
      fallbackMessage: "Hola!",
    });
    const toggled = { ...current, isEnabled: false };
    expect(toggled.inactivityMinutes).toBe(45);
    expect(toggled.useAIReply).toBe(true);
    expect(toggled.maxTokens).toBe(512);
    expect(toggled.fallbackMessage).toBe("Hola!");
  });
});
