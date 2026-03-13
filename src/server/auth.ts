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
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
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

        // Rate limit login attempts by email
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
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id;
      return session;
    },
  },
};

export default NextAuth(authOptions);
