import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { randomBytes } from "crypto";
import * as schema from "@/server/db/schema";
import { describe } from "vitest";

const TEST_URL = process.env.TEST_DATABASE_URL;

let cachedClient: ReturnType<typeof postgres> | null = null;
let cachedDb: PostgresJsDatabase<typeof schema> | null = null;

export function hasTestDb(): boolean {
  return !!TEST_URL;
}

/**
 * `describe.skip` when TEST_DATABASE_URL is missing, otherwise a normal
 * describe. Lets us co-locate E2E tests with unit tests without breaking
 * the default `npm test` run.
 */
export const e2eDescribe = hasTestDb() ? describe : describe.skip;

export function getTestDb(): PostgresJsDatabase<typeof schema> {
  if (!TEST_URL) {
    throw new Error(
      "TEST_DATABASE_URL is not set. E2E tests should be skipped via e2eDescribe."
    );
  }
  if (!cachedDb) {
    cachedClient = postgres(TEST_URL, { max: 4 });
    cachedDb = drizzle(cachedClient, { schema });
  }
  return cachedDb;
}

/**
 * Run a callback inside a transaction that is always rolled back at the end.
 * This keeps the test DB clean across runs and tests safely in parallel.
 */
export async function withTx<T>(
  fn: (tx: Parameters<Parameters<PostgresJsDatabase<typeof schema>["transaction"]>[0]>[0]) => Promise<T>
): Promise<T> {
  const db = getTestDb();
  let captured: T;
  await db
    .transaction(async (tx) => {
      captured = await fn(tx);
      // Force rollback by throwing a sentinel — drizzle rolls back on throw.
      throw new RollbackSentinel();
    })
    .catch((err) => {
      if (!(err instanceof RollbackSentinel)) throw err;
    });
  return captured!;
}

class RollbackSentinel extends Error {}

/** Quick seed helper: creator + email + password hash. */
export async function seedCreator(
  tx: Parameters<Parameters<PostgresJsDatabase<typeof schema>["transaction"]>[0]>[0],
  overrides: { email?: string; name?: string } = {}
): Promise<typeof schema.creators.$inferSelect> {
  const id = randomBytes(6).toString("hex");
  const [creator] = await tx
    .insert(schema.creators)
    .values({
      email: overrides.email ?? `e2e-${id}@example.com`,
      name: overrides.name ?? `E2E Creator ${id}`,
      passwordHash: "test-hash",
    })
    .returning();
  if (!creator) throw new Error("seedCreator failed");
  return creator;
}
