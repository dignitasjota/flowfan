/**
 * Backfill mediaItems sin r2Key/publicUrl subiéndolos a Cloudflare R2.
 *
 * Para cada mediaItem cuyo `r2_key IS NULL` y no sea vídeo:
 *   1. Lee el fichero desde `uploads/{storagePath}`.
 *   2. Calcula una nueva key R2 namespaced por creator.
 *   3. Sube el buffer con cache-control immutable.
 *   4. Actualiza `r2_key` + `public_url` en la fila.
 *
 * Pensado como tarea idempotente y reanudable: si falla a medias, vuelve a
 * ejecutarse y procesa los que quedaron pendientes.
 *
 * Flags:
 *   --dry-run     Solo lista lo que haría, no sube nada ni toca la DB.
 *   --limit N     Procesa como mucho N items (útil para validar antes de full run).
 *   --include-archived   Incluye items con `is_archived = true` (por defecto se saltan).
 *
 * Uso:
 *   npm run backfill:media-r2 -- --dry-run --limit 10
 *   npm run backfill:media-r2
 */

// Variables de entorno cargadas vía `tsx --env-file=.env` (ver script en package.json).
import { readFile } from "fs/promises";
import { join } from "path";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/server/db";
import { mediaItems } from "@/server/db/schema";
import {
  buildR2Key,
  isR2Configured,
  uploadBuffer,
} from "@/server/services/r2-storage";

const UPLOADS_DIR = join(process.cwd(), "uploads");

type Flags = {
  dryRun: boolean;
  limit: number | null;
  includeArchived: boolean;
};

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { dryRun: false, limit: null, includeArchived: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--include-archived") flags.includeArchived = true;
    else if (a === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(`--limit espera un entero >= 1, recibido: ${argv[i]}`);
      }
      flags.limit = Math.floor(n);
    } else if (a.startsWith("--")) {
      throw new Error(`Flag desconocida: ${a}`);
    }
  }
  return flags;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));

  if (!isR2Configured()) {
    console.error(
      "❌ R2 no está configurado. Define R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL."
    );
    process.exit(1);
  }

  console.log("🚀 Backfill mediaItems → R2");
  console.log(
    `   modo: ${flags.dryRun ? "DRY-RUN" : "EJECUTAR"} | limit: ${
      flags.limit ?? "sin límite"
    } | archived: ${flags.includeArchived ? "incluidos" : "excluidos"}`
  );

  // Vídeos quedan fuera por diseño (ver upload/route.ts). Si en el futuro
  // sube vídeos a R2, basta con quitar este filtro.
  const conditions = [isNull(mediaItems.r2Key), ne(mediaItems.mediaType, "video")];
  if (!flags.includeArchived) {
    conditions.push(eq(mediaItems.isArchived, false));
  }

  const candidates = await db.query.mediaItems.findMany({
    where: and(...conditions),
    limit: flags.limit ?? undefined,
    orderBy: (m, { asc }) => [asc(m.createdAt)],
  });

  if (candidates.length === 0) {
    console.log("✅ Nada que migrar — todos los mediaItems aplicables ya tienen r2_key.");
    return;
  }

  console.log(`📦 ${candidates.length} items pendientes\n`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of candidates) {
    const localPath = join(UPLOADS_DIR, item.storagePath);
    const label = `[${item.id}] ${item.originalName} (${item.mediaType}, ${(
      item.fileSize / 1024
    ).toFixed(1)}KB)`;

    let buffer: Buffer;
    try {
      buffer = await readFile(localPath);
    } catch (err) {
      console.warn(`⚠️  ${label} — archivo local no encontrado, skip:`, (err as Error).message);
      skipped++;
      continue;
    }

    if (flags.dryRun) {
      console.log(`🔎 ${label} — subiría ${buffer.byteLength} bytes`);
      uploaded++;
      continue;
    }

    try {
      const key = buildR2Key({
        creatorId: item.creatorId,
        originalName: item.originalName,
        mimeType: item.mimeType,
      });
      const result = await uploadBuffer({
        key,
        body: buffer,
        mimeType: item.mimeType,
        immutable: true,
      });

      await db
        .update(mediaItems)
        .set({ r2Key: result.key, publicUrl: result.publicUrl })
        .where(eq(mediaItems.id, item.id));

      console.log(`✅ ${label} → ${result.publicUrl}`);
      uploaded++;
    } catch (err) {
      console.error(`❌ ${label}:`, (err as Error).message);
      failed++;
    }
  }

  console.log("\n─── Resumen ──────────────────────────");
  console.log(`  subidos: ${uploaded}`);
  console.log(`  saltados (sin fichero local): ${skipped}`);
  console.log(`  fallidos: ${failed}`);
  console.log("──────────────────────────────────────");

  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
