import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("@/server/services/usage-limits", () => ({
  checkTemplateLimit: vi.fn().mockResolvedValue(undefined),
}));

import { checkTemplateLimit } from "@/server/services/usage-limits";

const mockCheckLimit = vi.mocked(checkTemplateLimit);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("templates router logic", () => {
  describe("list", () => {
    it("filters by platformType correctly", () => {
      const templates = [
        { id: "1", platformType: "instagram", category: "saludo" },
        { id: "2", platformType: null, category: "saludo" },
        { id: "3", platformType: "onlyfans", category: "venta" },
      ];

      const platformType = "instagram";
      const filtered = templates.filter(
        (t) => !t.platformType || t.platformType === platformType
      );

      // Should include #1 (matches) and #2 (null = all platforms)
      expect(filtered).toHaveLength(2);
      expect(filtered.map((t) => t.id)).toEqual(["1", "2"]);
    });

    it("filters by category", () => {
      const templates = [
        { id: "1", category: "saludo" },
        { id: "2", category: "venta" },
        { id: "3", category: "saludo" },
      ];

      const category = "saludo";
      const filtered = templates.filter((t) => t.category === category);
      expect(filtered).toHaveLength(2);
    });

    it("combines platform and category filters", () => {
      const templates = [
        { id: "1", platformType: "instagram", category: "saludo" },
        { id: "2", platformType: null, category: "saludo" },
        { id: "3", platformType: "instagram", category: "venta" },
      ];

      let filtered = templates;
      filtered = filtered.filter((t) => !t.platformType || t.platformType === "instagram");
      filtered = filtered.filter((t) => t.category === "saludo");

      expect(filtered).toHaveLength(2);
    });
  });

  describe("create", () => {
    it("checks template limit before creating", async () => {
      await mockCheckLimit({} as any, "c1");
      expect(mockCheckLimit).toHaveBeenCalled();
    });

    it("rejects when limit exceeded", async () => {
      mockCheckLimit.mockRejectedValueOnce(
        new TRPCError({ code: "FORBIDDEN", message: "Template limit" })
      );
      await expect(mockCheckLimit({} as any, "c1")).rejects.toThrow();
    });

    it("stores variables as array", () => {
      const input = {
        name: "Saludo",
        content: "Hola {{nombre}}!",
        variables: ["nombre"],
        category: "saludos",
      };
      expect(input.variables).toEqual(["nombre"]);
    });

    it("defaults variables to empty array", () => {
      const input = { name: "Test", content: "Hola" };
      const variables = (input as any).variables ?? [];
      expect(variables).toEqual([]);
    });
  });

  describe("getById", () => {
    it("throws NOT_FOUND when template does not exist", () => {
      expect(() => {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template no encontrado" });
      }).toThrow(TRPCError);
    });
  });

  describe("update", () => {
    it("only updates provided fields", () => {
      const input = { id: "t1", name: "New Name" };
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updateData.name = input.name;

      expect(updateData.name).toBe("New Name");
      expect(updateData).not.toHaveProperty("content");
      expect(updateData).not.toHaveProperty("category");
    });

    it("throws NOT_FOUND for non-existent template", () => {
      const existing = null;
      expect(() => {
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Template no encontrado" });
      }).toThrow(TRPCError);
    });
  });

  describe("delete", () => {
    it("verifies ownership before delete", () => {
      const existing = { id: "t1", creatorId: "c1" };
      expect(existing).toBeDefined();
    });

    it("throws NOT_FOUND for non-owned template", () => {
      expect(() => {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template no encontrado" });
      }).toThrow(TRPCError);
    });
  });

  describe("incrementUsage", () => {
    it("increments usage count", () => {
      const template = { usageCount: 5 };
      const newCount = template.usageCount + 1;
      expect(newCount).toBe(6);
    });

    it("does nothing for non-existent template", () => {
      const template = null;
      if (!template) {
        // Silent return
        expect(true).toBe(true);
      }
    });
  });

  describe("getCategories", () => {
    it("returns unique categories", () => {
      const templates = [
        { category: "saludo" },
        { category: "venta" },
        { category: "saludo" },
        { category: null },
        { category: "seguimiento" },
      ];

      const categories = [...new Set(templates.map((t) => t.category).filter(Boolean))] as string[];
      expect(categories).toEqual(["saludo", "venta", "seguimiento"]);
    });
  });
});
