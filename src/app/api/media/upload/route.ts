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
import {
  buildR2Key,
  isR2Configured,
  uploadBuffer as uploadToR2,
} from "@/server/services/r2-storage";
import { bufferMatchesMime } from "@/lib/file-magic";

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
    // Opcional: cuando "1", el item se sube a R2 pero `publicUrl` se devuelve
    // como null al cliente y /api/media/[id] firmará URL al vuelo en cada
    // request. Para media que no debe quedar como URL pública adivinable.
    const isPrivate = formData.get("isPrivate") === "1";

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

    // Verifica magic bytes: el header Content-Type lo manda el cliente y
    // podría no corresponder con el contenido real. Bloqueamos antes de
    // gastar CPU en sharp o subir a R2.
    if (!bufferMatchesMime(buffer, file.type)) {
      return NextResponse.json(
        {
          error:
            "El contenido del archivo no coincide con su tipo declarado.",
        },
        { status: 400 }
      );
    }

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

    // Upload destination: R2 when configured (preferred for cross-platform
    // publishing since the URL is public), otherwise local filesystem fallback.
    let r2Key: string | null = null;
    let publicUrl: string | null = null;

    if (isR2Configured()) {
      // R2 path — images, gifs and videos need a public URL accessible by
      // Reddit / Instagram / Twitter server-side fetchers. Videos travel as
      // the original buffer (sharp optimization only runs on raster images).
      try {
        const key = buildR2Key({
          creatorId,
          originalName: file.name,
          mimeType: file.type,
        });
        const uploaded = await uploadToR2({
          key,
          body: buffer,
          mimeType: file.type,
          immutable: true,
        });
        r2Key = uploaded.key;
        publicUrl = uploaded.publicUrl;
      } catch (uploadErr) {
        log.warn({ err: uploadErr }, "R2 upload failed, falling back to local FS");
      }
    }

    // Always keep a local copy for the Media Vault until we migrate the
    // legacy storagePath consumers (thumbnail serving, etc).
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

    // Insertar en DB. Si isPrivate, NO persistimos `publicUrl` en DB para que
    // ningún consumer la use por accidente; sólo queda r2Key, y el serving
    // route firma URL al vuelo.
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
        r2Key,
        publicUrl: isPrivate ? null : publicUrl,
        isPrivate,
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
