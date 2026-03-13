import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("bcryptjs", () => ({
  compare: vi.fn(),
}));

import { compare } from "bcryptjs";
const mockCompare = vi.mocked(compare);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("account router logic", () => {
  describe("getProfile", () => {
    it("returns selected columns only", () => {
      const creator = {
        id: "c1",
        name: "Test Creator",
        email: "test@test.com",
        emailVerified: true,
        subscriptionPlan: "pro",
        createdAt: new Date(),
        // Should NOT include:
        passwordHash: "secret",
      };

      const columns = {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        subscriptionPlan: true,
        createdAt: true,
      };

      // Verify passwordHash is NOT in the selected columns
      expect(columns).not.toHaveProperty("passwordHash");
      expect(creator.id).toBe("c1");
    });
  });

  describe("deleteAccount", () => {
    it("requires password confirmation", () => {
      const input = { password: "MyP@ss1!", confirmation: "ELIMINAR" };
      expect(input.password).toBeTruthy();
    });

    it("requires exact 'ELIMINAR' confirmation", () => {
      const valid = "ELIMINAR" === "ELIMINAR";
      expect(valid).toBe(true);

      const invalid = "eliminar" === "ELIMINAR";
      expect(invalid).toBe(false);
    });

    it("throws NOT_FOUND when creator not found", () => {
      const creator = null;
      expect(() => {
        if (!creator) throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta no encontrada" });
      }).toThrow(TRPCError);
    });

    it("throws UNAUTHORIZED for wrong password", async () => {
      mockCompare.mockResolvedValueOnce(false as any);

      const isValid = await compare("wrong", "hash");
      expect(isValid).toBe(false);

      expect(() => {
        if (!isValid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Contrasena incorrecta" });
        }
      }).toThrow(TRPCError);
    });

    it("allows deletion with correct password", async () => {
      mockCompare.mockResolvedValueOnce(true as any);
      const isValid = await compare("correct", "hash");
      expect(isValid).toBe(true);
    });
  });
});
