import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;

// En desarrollo el HMR reevalúa este módulo en cada cambio; sin cachear el
// cliente en globalThis se abría un pool nuevo por recarga hasta agotar
// `max_connections` de Postgres.
const globalForDb = globalThis as unknown as { __fanflowPg?: ReturnType<typeof postgres> };

const client =
  globalForDb.__fanflowPg ??
  postgres(connectionString, {
    max: Number(process.env.DB_POOL_MAX) || 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__fanflowPg = client;

export const db = drizzle(client, { schema });
