import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";

interface StorageConfig {
  bucket: string;
  endpoint: string;
  region: string;
  forcePathStyle: boolean;
  uriScheme: string;
  accessKeyId: string;
  secretAccessKey: string;
}

let cachedS3Client: S3Client | null = null;

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value.toLowerCase() === "true";
}

function getStorageConfig(): StorageConfig {
  const bucket = process.env.STORAGE_BUCKET;
  if (!bucket) {
    throw new Error("STORAGE_BUCKET is required.");
  }

  const endpoint = process.env.STORAGE_ENDPOINT ?? `http://127.0.0.1:${process.env.MINIO_PORT ?? "9000"}`;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID ?? process.env.MINIO_ROOT_USER;
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY ?? process.env.MINIO_ROOT_PASSWORD;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Storage credentials are required via STORAGE_* or MINIO_ROOT_* env vars.");
  }

  return {
    bucket,
    endpoint,
    region: process.env.STORAGE_REGION ?? "us-east-1",
    forcePathStyle: toBoolean(process.env.STORAGE_FORCE_PATH_STYLE, true),
    uriScheme: process.env.STORAGE_URI_SCHEME ?? "s3",
    accessKeyId,
    secretAccessKey
  };
}

function getS3Client(config: StorageConfig): S3Client {
  if (!cachedS3Client) {
    cachedS3Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
  }

  return cachedS3Client;
}

export async function uploadObjectBytes(objectKey: string, body: Buffer, contentType: string): Promise<string> {
  const config = getStorageConfig();
  const client = getS3Client(config);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType
    })
  );

  return `${config.uriScheme}://${config.bucket}/${objectKey}`;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

export async function downloadObjectBytes(objectKey: string): Promise<Buffer> {
  const config = getStorageConfig();
  const client = getS3Client(config);

  const response = await client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: objectKey
    })
  );

  if (!response.Body || !(response.Body instanceof Readable)) {
    throw new Error("Failed to read object body from storage.");
  }

  return streamToBuffer(response.Body);
}

export function objectKeyFromStorageUri(rawBlobUri: string): string {
  if (!rawBlobUri) {
    throw new Error("rawBlobUri is required.");
  }

  const normalized = rawBlobUri.trim();
  const marker = "://";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error("Invalid storage URI format.");
  }

  const withoutScheme = normalized.slice(markerIndex + marker.length);
  const firstSlash = withoutScheme.indexOf("/");
  if (firstSlash < 0) {
    throw new Error("Invalid storage URI format.");
  }

  const objectKey = withoutScheme.slice(firstSlash + 1);
  if (!objectKey) {
    throw new Error("Storage URI does not include an object key.");
  }

  return objectKey;
}

export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: Record<string, never>;
}

export function getRedisConnectionOptions(): RedisConnectionOptions {
  if (process.env.REDIS_URL) {
    const redisUrl = new URL(process.env.REDIS_URL);
    const isTls = redisUrl.protocol === "rediss:";

    return {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || (isTls ? 6380 : 6379)),
      username: redisUrl.username || undefined,
      password: redisUrl.password || undefined,
      tls: isTls ? {} : undefined
    };
  }

  return {
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined
  };
}

export function shouldParseInline(defaultValue: boolean): boolean {
  return toBoolean(process.env.UPLOAD_PARSE_INLINE, defaultValue);
}
