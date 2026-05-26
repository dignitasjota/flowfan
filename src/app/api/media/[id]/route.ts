import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import { db } from "@/server/db";
import { mediaItems } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { readFile } from "fs/promises";
import { join } from "path";

const UPLOADS_DIR = join(process.cwd(), "uploads");

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const url = new URL(request.url);
  const thumb = url.searchParams.get("thumb") === "1";

  const item = await db.query.mediaItems.findFirst({
    where: and(
      eq(mediaItems.id, id),
      eq(mediaItems.creatorId, session.user.id)
    ),
  });

  if (!item) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  // Thumbnails siguen en el FS local; no se suben a R2 (uso interno del Media
  // Vault, no se exponen a plataformas externas). Para el original con
  // publicUrl, redirigimos al CDN — descarga el VPS y aprovecha el cache R2.
  if (!thumb && item.publicUrl) {
    return NextResponse.redirect(item.publicUrl, 302);
  }

  const filePath = thumb && item.thumbnailPath
    ? join(UPLOADS_DIR, item.thumbnailPath)
    : join(UPLOADS_DIR, item.storagePath);

  try {
    const buffer = await readFile(filePath);
    const contentType = thumb ? "image/webp" : item.mimeType;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
  }
}
