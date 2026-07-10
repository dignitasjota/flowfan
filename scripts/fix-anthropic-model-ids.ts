/**
 * Corrige los model IDs de Anthropic con sufijo de fecha inválido (AI-1).
 *
 * Los IDs `claude-sonnet-4-6-20250514` y `claude-opus-4-6-20250514` no existen
 * en la API de Anthropic (los alias correctos no llevan fecha) y provocan un
 * 404 en cada llamada. Este script migra las configuraciones ya guardadas a los
 * IDs válidos:
 *   claude-sonnet-4-6-20250514 → claude-sonnet-4-6
 *   claude-opus-4-6-20250514   → claude-opus-4-6
 *
 * Afecta a las columnas `model` de `ai_configs` y `ai_model_assignments`.
 * Idempotente: volver a ejecutarlo no cambia nada nuevo.
 *
 * Flags:
 *   --dry-run   Solo cuenta cuántas filas se migrarían, no escribe.
 *
 * Uso:
 *   npx tsx --env-file-if-exists=.env scripts/fix-anthropic-model-ids.ts --dry-run
 *   npx tsx --env-file-if-exists=.env scripts/fix-anthropic-model-ids.ts
 */
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { aiConfigs, aiModelAssignments } from "@/server/db/schema";

const RENAMES: Array<[string, string]> = [
  ["claude-sonnet-4-6-20250514", "claude-sonnet-4-6"],
  ["claude-opus-4-6-20250514", "claude-opus-4-6"],
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  let total = 0;

  for (const [oldId, newId] of RENAMES) {
    const configs = await db.query.aiConfigs.findMany({
      where: eq(aiConfigs.model, oldId),
      columns: { id: true },
    });
    const assignments = await db.query.aiModelAssignments.findMany({
      where: eq(aiModelAssignments.model, oldId),
      columns: { id: true },
    });

    console.log(
      `${oldId} → ${newId}: ${configs.length} aiConfigs, ${assignments.length} aiModelAssignments`
    );
    total += configs.length + assignments.length;

    if (dryRun) continue;

    if (configs.length > 0) {
      await db
        .update(aiConfigs)
        .set({ model: newId, updatedAt: new Date() })
        .where(eq(aiConfigs.model, oldId));
    }
    if (assignments.length > 0) {
      await db
        .update(aiModelAssignments)
        .set({ model: newId, updatedAt: new Date() })
        .where(eq(aiModelAssignments.model, oldId));
    }
  }

  if (dryRun) {
    console.log(`Dry-run: ${total} fila(s) se migrarían. No se ha escrito nada.`);
  } else {
    console.log(`✅ ${total} fila(s) migradas.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
