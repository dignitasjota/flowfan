/**
 * Grandfathering de verificación de email.
 *
 * Al introducir la verificación de email OBLIGATORIA, las cuentas que ya
 * existían (creadas antes de la feature) tienen `email_verified = false` por
 * defecto y quedarían bloqueadas en el gate del dashboard. Este script marca
 * como verificadas todas las cuentas existentes para no expulsar a usuarios
 * legítimos.
 *
 * Idempotente: solo toca filas con `email_verified = false`. Volver a
 * ejecutarlo no cambia nada nuevo.
 *
 * Flags:
 *   --dry-run   Solo cuenta cuántas filas se marcarían, no escribe.
 *   --before=YYYY-MM-DD   Solo grandfatherea cuentas creadas antes de esa fecha
 *                         (por defecto: ahora, es decir todas las existentes).
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/grandfather-email-verified.ts --dry-run
 *   npx tsx --env-file=.env scripts/grandfather-email-verified.ts
 */

import { and, eq, lt } from "drizzle-orm";
import { db } from "@/server/db";
import { creators } from "@/server/db/schema";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const beforeArg = args.find((a) => a.startsWith("--before="))?.split("=")[1];
  const before = beforeArg ? new Date(beforeArg) : new Date();

  if (beforeArg && Number.isNaN(before.getTime())) {
    console.error(`Fecha --before inválida: ${beforeArg}`);
    process.exit(1);
  }

  const where = and(
    eq(creators.emailVerified, false),
    lt(creators.createdAt, before)
  );

  const pending = await db.query.creators.findMany({
    where,
    columns: { id: true, email: true, createdAt: true },
  });

  console.log(
    `${pending.length} cuenta(s) sin verificar creadas antes de ${before.toISOString()}.`
  );

  if (dryRun) {
    for (const c of pending) {
      console.log(`  [dry-run] marcaría ${c.email} (creada ${c.createdAt?.toISOString()})`);
    }
    console.log("Dry-run: no se ha escrito nada.");
    process.exit(0);
  }

  if (pending.length === 0) {
    console.log("Nada que hacer.");
    process.exit(0);
  }

  await db
    .update(creators)
    .set({ emailVerified: true, updatedAt: new Date() })
    .where(where);

  console.log(`✅ ${pending.length} cuenta(s) marcadas como verificadas.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
