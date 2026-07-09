import { describe, it, expect, vi } from "vitest";
import {
  generateReferralCode,
  REFERRAL_REWARD_CENTS,
  resolveReferrer,
  recordReferralConversion,
} from "@/server/services/referrals";

describe("generateReferralCode", () => {
  it("genera un código de 8 caracteres alfanuméricos en mayúscula sin ambiguos", () => {
    for (let i = 0; i < 20; i++) {
      const code = generateReferralCode();
      expect(code).toHaveLength(8);
      expect(code).toMatch(/^[A-Z0-9]{8}$/);
      // Sin caracteres ambiguos 0/O/1/I
      expect(code).not.toMatch(/[O01I]/);
    }
  });
});

describe("REFERRAL_REWARD_CENTS", () => {
  it("free no genera comisión, los de pago sí", () => {
    expect(REFERRAL_REWARD_CENTS.free).toBe(0);
    expect(REFERRAL_REWARD_CENTS.starter).toBeGreaterThan(0);
    expect(REFERRAL_REWARD_CENTS.pro).toBeGreaterThan(REFERRAL_REWARD_CENTS.starter);
    expect(REFERRAL_REWARD_CENTS.business).toBeGreaterThan(REFERRAL_REWARD_CENTS.pro);
  });
});

describe("resolveReferrer", () => {
  it("normaliza a mayúscula y busca el creator", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "referrer-1" });
    const db = { query: { creators: { findFirst } } };
    const id = await resolveReferrer(db as any, "  abcd1234 ");
    expect(id).toBe("referrer-1");
  });

  it("devuelve null para código vacío sin consultar la DB", async () => {
    const findFirst = vi.fn();
    const db = { query: { creators: { findFirst } } };
    expect(await resolveReferrer(db as any, "   ")).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("devuelve null si no existe el código", async () => {
    const findFirst = vi.fn().mockResolvedValue(undefined);
    const db = { query: { creators: { findFirst } } };
    expect(await resolveReferrer(db as any, "NOPE")).toBeNull();
  });
});

describe("recordReferralConversion", () => {
  it("no hace nada para plan free (sin comisión)", async () => {
    const findFirst = vi.fn();
    const db = { query: { creators: { findFirst } }, insert: vi.fn() };
    await recordReferralConversion(db as any, "ref-1", "free");
    expect(findFirst).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("no inserta si el creator no fue referido", async () => {
    const findFirst = vi.fn().mockResolvedValue({ referredById: null });
    const db = { query: { creators: { findFirst } }, insert: vi.fn() };
    await recordReferralConversion(db as any, "ref-1", "pro");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("inserta la comisión (onConflictDoNothing) cuando hay referrer", async () => {
    const findFirst = vi.fn().mockResolvedValue({ referredById: "referrer-1" });
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { query: { creators: { findFirst } }, insert };

    await recordReferralConversion(db as any, "referred-1", "pro");

    expect(insert).toHaveBeenCalledTimes(1);
    const inserted = values.mock.calls[0][0];
    expect(inserted).toMatchObject({
      referrerId: "referrer-1",
      referredId: "referred-1",
      plan: "pro",
      rewardCents: REFERRAL_REWARD_CENTS.pro,
      status: "pending",
    });
    expect(onConflictDoNothing).toHaveBeenCalled();
  });
});
