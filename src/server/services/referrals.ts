import { randomBytes } from "crypto";
import { eq, and } from "drizzle-orm";
import { creators, referralRewards } from "@/server/db/schema";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("referrals");

/** Comisión por conversión según el plan al que se suscribe el referido (cents). */
export const REFERRAL_REWARD_CENTS: Record<string, number> = {
  starter: 500, // €5
  pro: 1000, // €10
  business: 3000, // €30
  free: 0,
};

/** Genera un código de referido legible (8 chars alfanuméricos en mayúscula). */
export function generateReferralCode(): string {
  // base32-ish sin caracteres ambiguos (0/O, 1/I)
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/**
 * Devuelve el código de referido del creator, generándolo (con reintentos ante
 * colisión del índice único) si aún no tiene.
 */
export async function getOrCreateReferralCode(
  db: any,
  creatorId: string
): Promise<string> {
  const creator = await db.query.creators.findFirst({
    where: eq(creators.id, creatorId),
    columns: { referralCode: true },
  });
  if (creator?.referralCode) return creator.referralCode;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    try {
      await db
        .update(creators)
        .set({ referralCode: code, updatedAt: new Date() })
        .where(eq(creators.id, creatorId));
      return code;
    } catch (err) {
      // Colisión del unique index → reintentar con otro código.
      log.warn({ attempt }, "Referral code collision, retrying");
    }
  }
  throw new Error("No se pudo generar un código de referido único.");
}

/** Resuelve un código de referido a su creator (referrer). null si no existe. */
export async function resolveReferrer(
  db: any,
  code: string
): Promise<string | null> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  const referrer = await db.query.creators.findFirst({
    where: eq(creators.referralCode, normalized),
    columns: { id: true },
  });
  return referrer?.id ?? null;
}

/**
 * Registra la conversión de un referido cuando pasa a un plan de pago.
 * Idempotente: el índice único sobre referredId evita comisiones duplicadas.
 * No hace nada si el creator no fue referido o el plan no genera comisión.
 */
export async function recordReferralConversion(
  db: any,
  referredId: string,
  plan: string
): Promise<void> {
  const rewardCents = REFERRAL_REWARD_CENTS[plan] ?? 0;
  if (rewardCents <= 0) return;

  const referred = await db.query.creators.findFirst({
    where: eq(creators.id, referredId),
    columns: { referredById: true },
  });
  if (!referred?.referredById) return;

  try {
    await db
      .insert(referralRewards)
      .values({
        referrerId: referred.referredById,
        referredId,
        plan: plan as any,
        rewardCents,
        status: "pending",
      })
      .onConflictDoNothing();
  } catch (err) {
    log.warn({ err }, "Failed to record referral conversion");
  }
}

export type ReferralStats = {
  code: string | null;
  invited: number;
  converted: number;
  pendingCents: number;
  paidCents: number;
  totalCents: number;
};

export async function getReferralStats(
  db: any,
  creatorId: string
): Promise<ReferralStats> {
  const me = await db.query.creators.findFirst({
    where: eq(creators.id, creatorId),
    columns: { referralCode: true },
  });

  const invitedRows = await db.query.creators.findMany({
    where: eq(creators.referredById, creatorId),
    columns: { id: true },
  });

  const rewards = await db.query.referralRewards.findMany({
    where: eq(referralRewards.referrerId, creatorId),
    columns: { rewardCents: true, status: true },
  });

  const pendingCents = rewards
    .filter((r: any) => r.status === "pending")
    .reduce((a: number, r: any) => a + r.rewardCents, 0);
  const paidCents = rewards
    .filter((r: any) => r.status === "paid")
    .reduce((a: number, r: any) => a + r.rewardCents, 0);

  return {
    code: me?.referralCode ?? null,
    invited: invitedRows.length,
    converted: rewards.length,
    pendingCents,
    paidCents,
    totalCents: pendingCents + paidCents,
  };
}
