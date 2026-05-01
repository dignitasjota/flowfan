import { createHash, randomBytes } from "crypto";
import { eq, and } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import { apiKeys } from "@/server/db/schema";

type DB = Parameters<Parameters<typeof import("@/server/db").db.transaction>[0]>[0] | typeof import("@/server/db").db;

const KEY_PREFIX = "ff_live_";

export function generateRawKey(): string {
  return KEY_PREFIX + randomBytes(16).toString("hex");
}

export function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export async function createApiKey(
  db: DB,
  creatorId: string,
  name: string
): Promise<{ id: string; rawKey: string; keyPrefix: string }> {
  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);
  const encryptedKey = encrypt(rawKey);
  const keyPrefix = rawKey.slice(0, KEY_PREFIX.length + 8);

  const [inserted] = await (db as any)
    .insert(apiKeys)
    .values({
      creatorId,
      name,
      keyPrefix,
      keyHash,
      encryptedKey,
    })
    .returning({ id: apiKeys.id });

  return { id: inserted.id, rawKey, keyPrefix };
}

export async function validateApiKey(
  db: DB,
  rawKey: string
): Promise<{ creatorId: string; keyId: string } | null> {
  if (!rawKey.startsWith(KEY_PREFIX)) return null;

  const keyHash = hashKey(rawKey);

  const key = await (db as any).query.apiKeys.findFirst({
    where: and(
      eq(apiKeys.keyHash, keyHash),
      eq(apiKeys.isActive, true)
    ),
  });

  if (!key) return null;

  // Check expiry
  if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
    return null;
  }

  // Update lastUsedAt (fire-and-forget)
  (db as any)
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .catch(() => {});

  return { creatorId: key.creatorId, keyId: key.id };
}

export async function revokeApiKey(
  db: DB,
  keyId: string,
  creatorId: string
): Promise<void> {
  await (db as any)
    .update(apiKeys)
    .set({ isActive: false, revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.creatorId, creatorId)));
}

export async function listApiKeys(
  db: DB,
  creatorId: string
) {
  return (db as any).query.apiKeys.findMany({
    where: eq(apiKeys.creatorId, creatorId),
    columns: {
      id: true,
      name: true,
      keyPrefix: true,
      lastUsedAt: true,
      isActive: true,
      createdAt: true,
      revokedAt: true,
      expiresAt: true,
    },
    orderBy: (k: any, { desc }: any) => [desc(k.createdAt)],
  });
}
