import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomBytes } from "crypto";

/**
 * R2 / S3-compatible storage helper.
 *
 * Cloudflare R2 is S3-compatible, so we use the official AWS SDK with a custom
 * endpoint. Same code works against AWS S3, MinIO (local tests) or DigitalOcean
 * Spaces by just changing the endpoint env var.
 *
 * Required env vars:
 *   - R2_ENDPOINT          — e.g. https://<account-id>.r2.cloudflarestorage.com
 *   - R2_BUCKET            — bucket name
 *   - R2_ACCESS_KEY_ID
 *   - R2_SECRET_ACCESS_KEY
 *   - R2_PUBLIC_URL        — public base URL (e.g. https://pub-xxx.r2.dev or a
 *                            custom domain in front of the bucket). Used to
 *                            build the `publicUrl` returned to clients and
 *                            passed to Reddit / Instagram / Twitter.
 */

let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 storage is not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY."
    );
  }
  cachedClient = new S3Client({
    region: "auto", // R2 ignores region but the SDK requires a value
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  return cachedClient;
}

export function isR2Configured(): boolean {
  return !!(
    process.env.R2_ENDPOINT &&
    process.env.R2_BUCKET &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_PUBLIC_URL
  );
}

function getBucket(): string {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error("R2_BUCKET not configured");
  return bucket;
}

function getPublicBase(): string {
  const base = process.env.R2_PUBLIC_URL;
  if (!base) throw new Error("R2_PUBLIC_URL not configured");
  return base.replace(/\/$/, "");
}

/**
 * Build a stable object key. We namespace by creator to make rotation /
 * cleanup easy and avoid collisions across tenants.
 */
export function buildR2Key(args: {
  creatorId: string;
  originalName: string;
  mimeType: string;
}): string {
  const extFromName = args.originalName.match(/\.([a-zA-Z0-9]+)$/)?.[1];
  const extFromMime = args.mimeType.split("/")[1];
  const ext = (extFromName ?? extFromMime ?? "bin").toLowerCase().slice(0, 6);
  const random = randomBytes(12).toString("hex");
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `creators/${args.creatorId}/${date}/${random}.${ext}`;
}

export type UploadedObject = {
  key: string;
  publicUrl: string;
  size: number;
  mimeType: string;
};

export async function uploadBuffer(args: {
  key: string;
  body: Buffer;
  mimeType: string;
  /** When true, sets a long-lived cache header (1 year). Useful for media. */
  immutable?: boolean;
}): Promise<UploadedObject> {
  const bucket = getBucket();
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: args.key,
      Body: args.body,
      ContentType: args.mimeType,
      CacheControl: args.immutable
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600",
    })
  );
  return {
    key: args.key,
    publicUrl: `${getPublicBase()}/${args.key}`,
    size: args.body.byteLength,
    mimeType: args.mimeType,
  };
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: key,
    })
  );
}

/** Convenience: derive the public URL from a key without uploading. */
export function publicUrlFor(key: string): string {
  return `${getPublicBase()}/${key}`;
}
