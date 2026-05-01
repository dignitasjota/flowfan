import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db } from "@/server/db";
import { creators, passwordResetTokens } from "@/server/db/schema";
import { z } from "zod";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("auth-forgot-password");

const schema = z.object({
  email: z.string().email(),
});

export async function POST(req: Request) {
  // Rate limit by IP
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
  const rateLimitResult = await rateLimit(`forgot:${ip}`, RATE_LIMITS.register);

  if (!rateLimitResult.success) {
    // Still return 200 to avoid email enumeration
    return NextResponse.json({ success: true });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: true }); // Don't reveal validation errors
  }

  const { email } = parsed.data;

  // Check if user exists
  const creator = await db.query.creators.findFirst({
    where: eq(creators.email, email),
  });

  // Always return success to prevent email enumeration
  if (!creator) {
    return NextResponse.json({ success: true });
  }

  // Generate token
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db.insert(passwordResetTokens).values({
    email,
    token,
    expiresAt,
  });

  // Send password reset email
  const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password?token=${token}`;
  log.info({ email, resetUrl }, "Password reset URL generated");

  try {
    const { emailQueue } = await import("@/server/queues");
    await emailQueue.add("password_reset", {
      type: "password_reset" as const,
      to: email,
      data: { resetUrl },
    });
  } catch (err) {
    log.warn({ err, email }, "Failed to enqueue password reset email");
  }

  return NextResponse.json({ success: true });
}
