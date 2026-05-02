import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { db } from "@/server/db";
import type { Session } from "next-auth";
import { resolveUserPermissions } from "@/server/services/permissions";
import type { Permission } from "@/lib/permissions";

export type CreateContextOptions = {
  session: Session | null;
};

export const createTRPCContext = (opts: CreateContextOptions) => {
  return {
    db,
    session: opts.session,
  };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

const enforceAuth = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      session: ctx.session,
      creatorId: ctx.session.user.activeCreatorId ?? ctx.session.user.id,
      actingUserId: ctx.session.user.id,
      teamRole: ctx.session.user.teamRole ?? null,
    },
  });
});

const enforceAdmin = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (ctx.session.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acceso restringido a administradores." });
  }
  return next({
    ctx: {
      session: ctx.session,
      creatorId: ctx.session.user.activeCreatorId ?? ctx.session.user.id,
      actingUserId: ctx.session.user.id,
      teamRole: ctx.session.user.teamRole ?? null,
    },
  });
});

// Only the creator/owner can access
const enforceOwner = t.middleware(({ ctx, next }) => {
  const role = ctx.session?.user?.teamRole ?? null;
  if (role && role !== "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Solo el propietario puede realizar esta acción.",
    });
  }
  return next({ ctx });
});

// Owner or manager can access
const enforceManager = t.middleware(({ ctx, next }) => {
  const role = ctx.session?.user?.teamRole ?? null;
  if (role && role !== "owner" && role !== "manager") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tienes permisos para realizar esta acción.",
    });
  }
  return next({ ctx });
});

export const protectedProcedure = t.procedure.use(enforceAuth);
export const ownerProcedure = t.procedure.use(enforceAuth).use(enforceOwner);
export const managerProcedure = t.procedure.use(enforceAuth).use(enforceManager);
export const adminProcedure = t.procedure.use(enforceAdmin);

// Permission-based middleware
export function requirePermission(...permissions: Permission[]) {
  return t.middleware(async ({ ctx, next }) => {
    // Owner or own account always passes
    const role = ctx.session?.user?.teamRole ?? null;
    if (!role || role === "owner") {
      return next({ ctx });
    }
    const creatorId =
      ctx.session?.user?.activeCreatorId ?? ctx.session?.user?.id;
    const actingUserId = ctx.session?.user?.id;
    if (!creatorId || !actingUserId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    const userPerms = await resolveUserPermissions(db, creatorId, actingUserId);
    for (const p of permissions) {
      if (!userPerms.includes(p)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tienes permisos para realizar esta acción.",
        });
      }
    }
    return next({ ctx: { ...ctx, permissions: userPerms } });
  });
}

export const permissionProcedure = (...perms: Permission[]) =>
  t.procedure.use(enforceAuth).use(requirePermission(...perms));
