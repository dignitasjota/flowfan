import { desc, eq } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { referralRewards, creators } from "@/server/db/schema";
import {
  getOrCreateReferralCode,
  getReferralStats,
} from "@/server/services/referrals";

export const referralsRouter = createTRPCRouter({
  /** Devuelve (o genera) el código + link de referido del creator. */
  getMyCode: protectedProcedure.query(async ({ ctx }) => {
    const code = await getOrCreateReferralCode(ctx.db, ctx.creatorId);
    const base = process.env.NEXTAUTH_URL ?? "";
    return { code, link: `${base}/register?ref=${code}` };
  }),

  /** Estadísticas: invitados, conversiones y comisiones. */
  getStats: protectedProcedure.query(async ({ ctx }) => {
    return getReferralStats(ctx.db, ctx.creatorId);
  }),

  /** Historial de recompensas del referrer. */
  listRewards: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: referralRewards.id,
        plan: referralRewards.plan,
        rewardCents: referralRewards.rewardCents,
        status: referralRewards.status,
        createdAt: referralRewards.createdAt,
        referredName: creators.name,
      })
      .from(referralRewards)
      .leftJoin(creators, eq(referralRewards.referredId, creators.id))
      .where(eq(referralRewards.referrerId, ctx.creatorId))
      .orderBy(desc(referralRewards.createdAt))
      .limit(100);
    return rows;
  }),
});
