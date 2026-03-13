import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock crypto
vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn((val: string) => `decrypted:${val}`),
}));

// Mock DB schema
vi.mock("@/server/db/schema", () => ({
  aiConfigs: { creatorId: "aiConfigs.creatorId" },
  aiModelAssignments: { creatorId: "assignments.creatorId", taskType: "assignments.taskType" },
}));

import { resolveAIConfig } from "@/server/services/ai-config-resolver";
import { decrypt } from "@/lib/crypto";

const mockDecrypt = vi.mocked(decrypt);

function mockDb(assignment: Record<string, unknown> | null, defaultConfig: Record<string, unknown> | null) {
  return {
    query: {
      aiModelAssignments: {
        findFirst: vi.fn().mockResolvedValue(assignment),
      },
      aiConfigs: {
        findFirst: vi.fn().mockResolvedValue(defaultConfig),
      },
    },
  } as unknown as Parameters<typeof resolveAIConfig>[0];
}

describe("resolveAIConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecrypt.mockImplementation((val: string) => `decrypted:${val}`);
  });

  it("returns task-specific assignment with own API key", async () => {
    const db = mockDb(
      { provider: "openai", model: "gpt-4o", apiKey: "encrypted-key" },
      { provider: "anthropic", model: "claude-sonnet-4-20250514", apiKey: "default-encrypted" }
    );

    const result = await resolveAIConfig(db, "creator-1", "suggestion");

    expect(result).toEqual({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "decrypted:encrypted-key",
    });
  });

  it("uses assignment provider/model but default config API key when assignment has no key", async () => {
    const db = mockDb(
      { provider: "openai", model: "gpt-4o", apiKey: null },
      { provider: "anthropic", model: "claude-sonnet-4-20250514", apiKey: "default-encrypted" }
    );

    const result = await resolveAIConfig(db, "creator-1", "analysis");

    expect(result).toEqual({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "decrypted:default-encrypted",
    });
  });

  it("falls back to default config when no assignment exists", async () => {
    const db = mockDb(
      null,
      { provider: "anthropic", model: "claude-sonnet-4-20250514", apiKey: "default-key" }
    );

    const result = await resolveAIConfig(db, "creator-1", "summary");

    expect(result).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiKey: "decrypted:default-key",
    });
  });

  it("returns null when no config exists at all", async () => {
    const db = mockDb(null, null);

    const result = await resolveAIConfig(db, "creator-1", "report");
    expect(result).toBeNull();
  });

  it("returns null when assignment exists without key and no default config", async () => {
    const db = mockDb(
      { provider: "openai", model: "gpt-4o", apiKey: null },
      null
    );

    const result = await resolveAIConfig(db, "creator-1", "suggestion");
    // Assignment without key needs default config for API key, which doesn't exist
    // Falls through to default config check which also returns null
    expect(result).toBeNull();
  });

  it("decrypts API keys", async () => {
    const db = mockDb(
      null,
      { provider: "anthropic", model: "claude-sonnet-4-20250514", apiKey: "enc:abc:def" }
    );

    await resolveAIConfig(db, "creator-1", "suggestion");
    expect(mockDecrypt).toHaveBeenCalledWith("enc:abc:def");
  });
});
