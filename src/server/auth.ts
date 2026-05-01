import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { creators } from "./db/schema";
import { compare } from "bcryptjs";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";

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
  }
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

        // Rate limit login attempts by IP (prevent credential stuffing across emails)
        const forwarded = req?.headers?.["x-forwarded-for"];
        const ip = (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined) ?? "unknown";
        const ipLimit = await rateLimit(`login-ip:${ip}`, { limit: 15, windowSeconds: 300 });
        if (!ipLimit.success) return null;

        // Rate limit login attempts by email (prevent brute force on single account)
        const rateLimitResult = await rateLimit(
          `login:${credentials.email}`,
          RATE_LIMITS.auth
        );
        if (!rateLimitResult.success) return null;

        const creator = await db.query.creators.findFirst({
          where: eq(creators.email, credentials.email),
        });

        if (!creator) return null;

        const isValid = await compare(
          credentials.password,
          creator.passwordHash
        );
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
        token.role = (user as any).role ?? "creator";
        token.onboardingCompleted = (user as any).onboardingCompleted ?? false;
        token.activeCreatorId = user.id; // default: act as self
        token.teamRole = null;
      }
      if (trigger === "update") {
        const s = session as any;
        if (s?.onboardingCompleted !== undefined) {
          token.onboardingCompleted = s.onboardingCompleted;
        }
        // Team switch: validate membership before updating
        if (s?.activeCreatorId && s.activeCreatorId !== token.id) {
          const { teamMembers } = await import("./db/schema");
          const { and, eq: eqOp } = await import("drizzle-orm");
          const membership = await db.query.teamMembers.findFirst({
            where: and(
              eqOp(teamMembers.creatorId, s.activeCreatorId),
              eqOp(teamMembers.userId, token.id),
              eqOp(teamMembers.isActive, true)
            ),
          });
          if (membership) {
            token.activeCreatorId = s.activeCreatorId;
            token.teamRole = membership.role as "owner" | "manager" | "chatter";
          }
        } else if (s?.activeCreatorId === token.id) {
          // Switch back to own account
          token.activeCreatorId = token.id;
          token.teamRole = null;
        }
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role ?? "creator";
      session.user.activeCreatorId = token.activeCreatorId ?? token.id;
      session.user.teamRole = token.teamRole ?? null;
      return session;
    },
  },
};

export default NextAuth(authOptions);
