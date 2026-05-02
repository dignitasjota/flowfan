import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  setPresence,
  removePresence,
  getOnlineMembers,
  setTyping,
  clearTyping,
  setViewing,
  clearViewing,
  getViewers,
} from "@/server/services/presence";

export const presenceRouter = createTRPCRouter({
  heartbeat: protectedProcedure
    .input(z.object({ status: z.enum(["online", "away"]) }))
    .mutation(async ({ ctx, input }) => {
      await setPresence(
        ctx.creatorId,
        ctx.actingUserId,
        input.status,
        ctx.session.user.name ?? "Unknown"
      );
      return { ok: true };
    }),

  getOnlineMembers: protectedProcedure.query(async ({ ctx }) => {
    return getOnlineMembers(ctx.creatorId);
  }),

  startTyping: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await setTyping(
        ctx.creatorId,
        input.conversationId,
        ctx.actingUserId,
        ctx.session.user.name ?? "Unknown"
      );
      return { ok: true };
    }),

  stopTyping: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await clearTyping(ctx.creatorId, input.conversationId, ctx.actingUserId);
      return { ok: true };
    }),

  viewConversation: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await setViewing(
        ctx.creatorId,
        input.conversationId,
        ctx.actingUserId,
        ctx.session.user.name ?? "Unknown"
      );
      return { ok: true };
    }),

  leaveConversation: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await clearViewing(ctx.creatorId, input.conversationId, ctx.actingUserId);
      return { ok: true };
    }),

  getViewers: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return getViewers(ctx.creatorId, input.conversationId);
    }),
});
