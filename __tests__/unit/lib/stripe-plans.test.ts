import { describe, it, expect, beforeEach, afterEach } from "vitest";

// getPlanFromPriceId / isPlanCheckoutable leen los price IDs desde process.env
// vía getters, así que basta con setear las envs antes de importar.

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.STRIPE_STARTER_PRICE_ID = "price_starter";
  process.env.STRIPE_PRO_PRICE_ID = "price_pro";
  delete process.env.STRIPE_BUSINESS_PRICE_ID;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("getPlanFromPriceId", () => {
  it("mapea starter y pro", async () => {
    const { getPlanFromPriceId } = await import("@/lib/stripe");
    expect(getPlanFromPriceId("price_starter")).toBe("starter");
    expect(getPlanFromPriceId("price_pro")).toBe("pro");
  });

  it("mapea business cuando su price ID está configurado", async () => {
    process.env.STRIPE_BUSINESS_PRICE_ID = "price_business";
    const { getPlanFromPriceId } = await import("@/lib/stripe");
    expect(getPlanFromPriceId("price_business")).toBe("business");
  });

  it("devuelve null para un price desconocido", async () => {
    const { getPlanFromPriceId } = await import("@/lib/stripe");
    expect(getPlanFromPriceId("price_unknown")).toBeNull();
  });
});

describe("isPlanCheckoutable", () => {
  it("starter y pro siempre son checkoutable (price configurado)", async () => {
    const { isPlanCheckoutable } = await import("@/lib/stripe");
    expect(isPlanCheckoutable("starter")).toBe(true);
    expect(isPlanCheckoutable("pro")).toBe(true);
  });

  it("business NO es checkoutable si falta STRIPE_BUSINESS_PRICE_ID", async () => {
    const { isPlanCheckoutable } = await import("@/lib/stripe");
    expect(isPlanCheckoutable("business")).toBe(false);
  });

  it("business ES checkoutable cuando STRIPE_BUSINESS_PRICE_ID está seteado", async () => {
    process.env.STRIPE_BUSINESS_PRICE_ID = "price_business";
    const { isPlanCheckoutable } = await import("@/lib/stripe");
    expect(isPlanCheckoutable("business")).toBe(true);
  });
});
