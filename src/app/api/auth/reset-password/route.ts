import { NextResponse } from "next/server";
import { eq, and, gt, isNull } from "drizzle-orm";
import { hash } from "bcryptjs";
import { db } from "@/server/db";
import { creators, passwordResetTokens } from "@/server/db/schema";
import { z } from "zod";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";

const passwordSchema = z
  .string()
  .min(8, "La contrasena debe tener al menos 8 caracteres")
  .regex(/[A-Z]/, "Debe contener al menos una letra mayuscula")
  .regex(/[a-z]/, "Debe contener al menos una letra minuscula")
  .regex(/[0-9]/, "Debe contener al menos un numero")
  .regex(/[^A-Za-z0-9]/, "Debe contener al menos un caracter especial");

const schema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export async function POST(req: Request) {
  // Rate limit
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
  const rateLimitResult = await rateLimit(`reset:${ip}`, RATE_LIMITS.auth);

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Demasiados intentos. Intentalo de nuevo mas tarde." },
      { status: 429 }
    );
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? "Datos invalidos";
    return NextResponse.json({ error: firstError }, { status: 400 });
  }

  const { token, password } = parsed.data;

  // Find valid, unused token
  const resetToken = await db.query.passwordResetTokens.findFirst({
    where: and(
      eq(passwordResetTokens.token, token),
      gt(passwordResetTokens.expiresAt, new Date()),
      isNull(passwordResetTokens.usedAt)
    ),
  });

  if (!resetToken) {
    return NextResponse.json(
      { error: "El enlace ha expirado o ya fue utilizado. Solicita uno nuevo." },
      { status: 400 }
    );
  }

  // Update password
  const passwordHash = await hash(password, 12);
  await db
    .update(creators)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(creators.email, resetToken.email));

  // Mark token as used
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, resetToken.id));

  return NextResponse.json({ success: true });
}
