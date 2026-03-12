import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { creators } from "@/server/db/schema";
import { z } from "zod";

const registerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos" },
      { status: 400 }
    );
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

  await db.insert(creators).values({
    name,
    email,
    passwordHash,
  });

  return NextResponse.json({ success: true }, { status: 201 });
}
