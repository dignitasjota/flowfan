/**
 * Asegura el trigger de full-text search sobre `messages.search_vector`.
 *
 * `db:push` sincroniza columnas e índices desde `schema.ts`, pero NO crea
 * funciones ni triggers. En despliegues que usan `db:push` (en vez de
 * `db:migrate`, que ya incluye esto en 0010_schema_sync.sql) hay que ejecutar
 * este script después del push para que los mensajes nuevos sean buscables.
 *
 * Idempotente. Uso:
 *   npm run db:ensure-search
 */

import { sql } from "drizzle-orm";
import { db } from "@/server/db";

async function main() {
  await db.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS search_vector tsvector`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS messages_search_idx ON messages USING gin (search_vector)`
  );
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
    BEGIN
      NEW.search_vector := to_tsvector('spanish', COALESCE(NEW.content, '')) || to_tsvector('english', COALESCE(NEW.content, ''));
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `));
  await db.execute(sql`DROP TRIGGER IF EXISTS messages_search_vector_trigger ON messages`);
  await db.execute(
    sql`CREATE TRIGGER messages_search_vector_trigger BEFORE INSERT OR UPDATE OF content ON messages FOR EACH ROW EXECUTE FUNCTION messages_search_vector_update()`
  );
  const res = await db.execute(
    sql`UPDATE messages SET search_vector = to_tsvector('spanish', COALESCE(content, '')) || to_tsvector('english', COALESCE(content, '')) WHERE search_vector IS NULL`
  );
  console.log(`Trigger de búsqueda asegurado. Filas backfilleadas: ${(res as { count?: number }).count ?? "?"}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
