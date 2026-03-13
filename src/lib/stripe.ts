import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-02-25.clover",
      typescript: true,
    });
  }
  return _stripe;
}

export const PLAN_PRICE_IDS = {
  get starter() {
    return process.env.STRIPE_STARTER_PRICE_ID!;
  },
  get pro() {
    return process.env.STRIPE_PRO_PRICE_ID!;
  },
} as const;

export function getPlanFromPriceId(priceId: string): "starter" | "pro" | null {
  if (priceId === PLAN_PRICE_IDS.starter) return "starter";
  if (priceId === PLAN_PRICE_IDS.pro) return "pro";
  return null;
}
