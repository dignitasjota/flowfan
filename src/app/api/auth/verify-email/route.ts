import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { creators } from "@/server/db/schema";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(
      new URL("/login?error=invalid-token", process.env.NEXTAUTH_URL!)
    );
  }

  const creator = await db.query.creators.findFirst({
    where: eq(creators.emailVerificationToken, token),
  });

  if (!creator) {
    return NextResponse.redirect(
      new URL("/login?error=invalid-token", process.env.NEXTAUTH_URL!)
    );
  }

  if (creator.emailVerified) {
    return NextResponse.redirect(
      new URL("/login?verified=already", process.env.NEXTAUTH_URL!)
    );
  }

  // Token expirado (SEC-8): pedir al usuario que reenvíe desde el aviso.
  if (
    creator.emailVerificationExpiresAt &&
    creator.emailVerificationExpiresAt.getTime() < Date.now()
  ) {
    return NextResponse.redirect(
      new URL("/login?error=token-expired", process.env.NEXTAUTH_URL!)
    );
  }

  await db
    .update(creators)
    .set({
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(creators.id, creator.id));

  return NextResponse.redirect(
    new URL("/login?verified=true", process.env.NEXTAUTH_URL!)
  );
}
