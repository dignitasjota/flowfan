import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { creators } from "@/server/db/schema";
import { z } from "zod";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("auth-register");

// Password must have: 8+ chars, 1 uppercase, 1 lowercase, 1 number, 1 special char
const passwordSchema = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .regex(/[A-Z]/, "Debe contener al menos una letra mayúscula")
  .regex(/[a-z]/, "Debe contener al menos una letra minúscula")
  .regex(/[0-9]/, "Debe contener al menos un número")
  .regex(
    /[^A-Za-z0-9]/,
    "Debe contener al menos un carácter especial (!@#$%...)"
  );

const registerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  password: passwordSchema,
});

export async function POST(req: Request) {
  // --- CSRF protection: verify Origin matches our domain ---
  const origin = req.headers.get("origin");
  const expectedOrigin = process.env.NEXTAUTH_URL;
  if (expectedOrigin && origin && origin !== expectedOrigin) {
    return NextResponse.json(
      { error: "Solicitud no autorizada" },
      { status: 403 }
    );
  }

  // --- Rate limiting by IP ---
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
  const rateLimitResult = await rateLimit(
    `register:${ip}`,
    RATE_LIMITS.register
  );

  if (!rateLimitResult.success) {
    return NextResponse.json(
      {
        error:
          "Demasiados intentos de registro. Inténtalo de nuevo en unos minutos.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimitResult.resetAt - Math.floor(Date.now() / 1000)),
        },
      }
    );
  }

  const body = await req.json();
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    // Return the first validation error message
    const firstError = parsed.error.errors[0]?.message ?? "Datos inválidos";
    return NextResponse.json({ error: firstError }, { status: 400 });
  }

  const { name, email, password } = parsed.data;

  // Check if email already exists
  const existing = await db.query.creators.findFirst({
    where: eq(creators.email, email),
  });

  if (existing) {
    return NextResponse.json(
      { error: "Este email ya está registrado" },
      { status: 409 }
    );
  }

  const passwordHash = await hash(password, 12);
  const verificationToken = randomBytes(32).toString("hex");

  await db.insert(creators).values({
    name,
    email,
    passwordHash,
    emailVerificationToken: verificationToken,
  });

  // Send verification email
  const verifyUrl = `${process.env.NEXTAUTH_URL}/api/auth/verify-email?token=${verificationToken}`;
  log.info({ email, verifyUrl }, "Email verification URL generated");

  try {
    const { emailQueue } = await import("@/server/queues");
    await emailQueue.add("verification", {
      type: "verification" as const,
      to: email,
      data: { verifyUrl },
    });
  } catch (err) {
    log.warn({ err, email }, "Failed to enqueue verification email");
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
