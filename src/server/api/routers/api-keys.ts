import { z } from "zod";
import { createTRPCRouter, ownerProcedure, permissionProcedure } from "../trpc";
import { createApiKey, revokeApiKey, listApiKeys } from "@/server/services/api-keys";
import { checkApiAccess } from "@/server/services/usage-limits";

export const apiKeysRouter = createTRPCRouter({
  list: permissionProcedure("api.manage_keys").query(async ({ ctx }) => {
    await checkApiAccess(ctx.db, ctx.creatorId);
    return listApiKeys(ctx.db, ctx.creatorId);
  }),

  create: permissionProcedure("api.manage_keys")
    .input(z.object({ name: z.string().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      await checkApiAccess(ctx.db, ctx.creatorId);
      const result = await createApiKey(ctx.db, ctx.creatorId, input.name);
      return result;
    }),

  revoke: permissionProcedure("api.manage_keys")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await revokeApiKey(ctx.db, input.id, ctx.creatorId);
      return { success: true };
    }),
});
