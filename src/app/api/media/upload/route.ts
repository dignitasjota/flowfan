import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import { db } from "@/server/db";
import { mediaItems } from "@/server/db/schema";
import { checkMediaFileLimit, checkMediaStorageLimit } from "@/server/services/usage-limits";
import { createChildLogger } from "@/lib/logger";
import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import sharp from "sharp";

const log = createChildLogger("media-upload");

const ALLOWED_MIMES: Record<string, { ext: string; mediaType: "image" | "video" | "gif" }> = {
  "image/jpeg": { ext: "jpg", mediaType: "image" },
  "image/png": { ext: "png", mediaType: "image" },
  "image/gif": { ext: "gif", mediaType: "gif" },
  "image/webp": { ext: "webp", mediaType: "image" },
  "video/mp4": { ext: "mp4", mediaType: "video" },
  "video/quicktime": { ext: "mov", mediaType: "video" },
  "video/webm": { ext: "webm", mediaType: "video" },
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const UPLOADS_DIR = join(process.cwd(), "uploads");

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const creatorId = session.user.id;
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const categoryId = formData.get("categoryId") as string | null;
    const tagsRaw = formData.get("tags") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No se proporcionó archivo" }, { status: 400 });
    }

    // Validar MIME
    const mimeInfo = ALLOWED_MIMES[file.type];
    if (!mimeInfo) {
      return NextResponse.json(
        { error: "Tipo de archivo no permitido. Formatos: JPG, PNG, GIF, WebP, MP4, MOV, WebM" },
        { status: 400 }
      );
    }

    // Validar tamaño
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "El archivo excede el límite de 50MB" },
        { status: 400 }
      );
    }

    // Check plan limits
    await checkMediaFileLimit(db, creatorId);
    await checkMediaStorageLimit(db, creatorId, file.size);

    // Generar paths
    const fileId = randomUUID();
    const filename = `${fileId}.${mimeInfo.ext}`;
    const creatorDir = join(UPLOADS_DIR, creatorId);
    const filePath = join(creatorDir, filename);
    const storagePath = `${creatorId}/${filename}`;

    // Crear directorio
    await mkdir(creatorDir, { recursive: true });

    // Escribir archivo (con optimización para imágenes)
    let buffer: Buffer = Buffer.from(await file.arrayBuffer());
    let optimizedSize = file.size;

    if (mimeInfo.mediaType === "image" && mimeInfo.ext !== "gif") {
      try {
        const metadata = await sharp(buffer).metadata();
        const maxDim = 2048;
        let pipeline = sharp(buffer);

        // Redimensionar si excede 2048px en cualquier lado
        if ((metadata.width && metadata.width > maxDim) || (metadata.height && metadata.height > maxDim)) {
          pipeline = pipeline.resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true });
        }

        // Optimizar calidad según formato
        if (mimeInfo.ext === "jpg") {
          buffer = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
        } else if (mimeInfo.ext === "png") {
          buffer = await pipeline.png({ compressionLevel: 8 }).toBuffer();
        } else if (mimeInfo.ext === "webp") {
          buffer = await pipeline.webp({ quality: 85 }).toBuffer();
        } else {
          buffer = await pipeline.toBuffer();
        }
        optimizedSize = buffer.length;
      } catch {
        // Si falla la optimización, usar buffer original
      }
    }

    await writeFile(filePath, buffer);

    // Generar thumbnail + obtener dimensiones
    let thumbnailPath: string | null = null;
    let width: number | null = null;
    let height: number | null = null;

    if (mimeInfo.mediaType === "image" || mimeInfo.mediaType === "gif") {
      try {
        const metadata = await sharp(buffer).metadata();
        width = metadata.width ?? null;
        height = metadata.height ?? null;

        const thumbFilename = `${fileId}_thumb.webp`;
        const thumbFullPath = join(creatorDir, thumbFilename);
        await sharp(buffer)
          .resize(200, 200, { fit: "cover" })
          .webp({ quality: 70 })
          .toFile(thumbFullPath);
        thumbnailPath = `${creatorId}/${thumbFilename}`;
      } catch {
        // Si falla el thumbnail, no es crítico
      }
    }

    // Tags
    const tags = tagsRaw
      ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

    // Insertar en DB
    const [mediaItem] = await db
      .insert(mediaItems)
      .values({
        creatorId,
        filename,
        originalName: file.name,
        mimeType: file.type,
        mediaType: mimeInfo.mediaType,
        fileSize: optimizedSize,
        storagePath,
        thumbnailPath,
        width,
        height,
        tags,
        categoryId: categoryId || null,
      })
      .returning();

    return NextResponse.json(mediaItem);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "FORBIDDEN") {
      const msg = "message" in error ? String(error.message) : "Límite alcanzado";
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    log.error({ err: error }, "Upload error");
    return NextResponse.json(
      { error: "Error al subir el archivo" },
      { status: 500 }
    );
  }
}
