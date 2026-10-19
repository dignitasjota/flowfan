import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { creators, teamMembers } from "./db/schema";
import { compare } from "bcryptjs";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getClientIpFromHeaders } from "@/lib/request-ip";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: "creator" | "admin";
      activeCreatorId: string;
      teamRole: "owner" | "manager" | "chatter" | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "creator" | "admin";
    onboardingCompleted: boolean;
    activeCreatorId: string;
    teamRole: "owner" | "manager" | "chatter" | null;
    /** Epoch ms de la última revalidación contra BD. */
    revalidatedAt?: number;
    /** La cuenta ya no existe: la sesión debe tratarse como no autenticada. */
    revoked?: boolean;
  }
}

/**
 * Cada cuánto se revalidan contra BD los datos sensibles del token (rol de
 * plataforma, existencia de la cuenta, membresía y rol de equipo). Antes solo
 * se fijaban al hacer login o al cambiar de equipo, así que eliminar a un
 * miembro, degradarlo o quitarle el rol admin no surtía efecto hasta que
 * caducaba el JWT (30 días).
 */
const REVALIDATE_INTERVAL_MS = 60_000;

type TeamRole = "owner" | "manager" | "chatter";

async function loadActiveMembership(
  creatorId: string,
  userId: string
): Promise<TeamRole | null> {
  const membership = await db.query.teamMembers.findFirst({
    where: and(
      eq(teamMembers.creatorId, creatorId),
      eq(teamMembers.userId, userId),
      eq(teamMembers.isActive, true)
    ),
    columns: { role: true },
  });
  return (membership?.role as TeamRole | undefined) ?? null;
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;

        // SEC-4: misma extracción de IP que el resto de endpoints de auth
        // (respeta TRUSTED_PROXY_HOPS) en vez del primer valor crudo de XFF.
        const headers = (req?.headers ?? {}) as Record<string, string | string[] | undefined>;
        const ip = getClientIpFromHeaders((name) => headers[name]);
        const ipLimit = await rateLimit(`login-ip:${ip}`, {
          limit: 15,
          windowSeconds: 300,
          failClosed: true,
        });
        if (!ipLimit.success) return null;

        const email = credentials.email.trim().toLowerCase();

        // Rate limit login attempts by email (prevent brute force on single account)
        const rateLimitResult = await rateLimit(`login:${email}`, RATE_LIMITS.auth);
        if (!rateLimitResult.success) return null;

        const creator = await db.query.creators.findFirst({
          // Comparación case-insensitive: hay cuentas antiguas guardadas con
          // mayúsculas; las nuevas se normalizan a minúsculas al registrarse.
          where: sql`lower(${creators.email}) = ${email}`,
        });

        if (!creator) return null;

        const isValid = await compare(credentials.password, creator.passwordHash);
        if (!isValid) return null;

        return {
          id: creator.id,
          email: creator.email,
          name: creator.name,
          role: creator.role as "creator" | "admin",
          onboardingCompleted: creator.onboardingCompleted,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: "creator" | "admin" }).role ?? "creator";
        token.onboardingCompleted =
          (user as { onboardingCompleted?: boolean }).onboardingCompleted ?? false;
        token.activeCreatorId = user.id; // default: act as self
        token.teamRole = null;
        token.revalidatedAt = Date.now();
        token.revoked = false;
        return token;
      }

      if (trigger === "update") {
        const s = (session ?? {}) as {
          onboardingCompleted?: boolean;
          activeCreatorId?: string | null;
        };
        if (s.onboardingCompleted !== undefined) {
          token.onboardingCompleted = s.onboardingCompleted;
        }
        if ("activeCreatorId" in s) {
          // `null` o el propio id = volver a la cuenta propia.
          if (!s.activeCreatorId || s.activeCreatorId === token.id) {
            token.activeCreatorId = token.id;
            token.teamRole = null;
          } else {
            const role = await loadActiveMembership(s.activeCreatorId, token.id);
            if (role) {
              token.activeCreatorId = s.activeCreatorId;
              token.teamRole = role;
            }
          }
        }
      }

      // Revalidación periódica contra BD.
      if (
        token.id &&
        Date.now() - (token.revalidatedAt ?? 0) > REVALIDATE_INTERVAL_MS
      ) {
        const creator = await db.query.creators.findFirst({
          where: eq(creators.id, token.id),
          columns: { id: true, role: true, onboardingCompleted: true },
        });
        if (!creator) {
          token.revoked = true;
        } else {
          token.revoked = false;
          token.role = creator.role as "creator" | "admin";
          token.onboardingCompleted = creator.onboardingCompleted;
          if (token.activeCreatorId && token.activeCreatorId !== token.id) {
            const role = await loadActiveMembership(token.activeCreatorId, token.id);
            if (role) {
              token.teamRole = role;
            } else {
              // Membresía revocada: vuelve a la cuenta propia.
              token.activeCreatorId = token.id;
              token.teamRole = null;
            }
          }
        }
        token.revalidatedAt = Date.now();
      }

      return token;
    },
    session({ session, token }) {
      if (token.revoked || !token.id) {
        // Sin `user` → enforceAuth/layouts lo tratan como no autenticado.
        return { ...session, user: undefined } as unknown as typeof session;
      }
      session.user.id = token.id;
      session.user.role = token.role ?? "creator";
      session.user.activeCreatorId = token.activeCreatorId ?? token.id;
      session.user.teamRole = token.teamRole ?? null;
      return session;
    },
  },
};

export default NextAuth(authOptions);
