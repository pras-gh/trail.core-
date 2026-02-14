import { Prisma, PrismaClient } from "@prisma/client";

function buildDatabaseUrlFromDiscreteEnv(): string | null {
  const host = process.env.POSTGRES_HOST ?? "127.0.0.1";
  const port = process.env.POSTGRES_PORT ?? "5432";
  const user = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD;
  const database = process.env.POSTGRES_DB;

  if (!user || !password || !database) {
    return null;
  }

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}?schema=public`;
}

export function ensureDatabaseUrl(): string {
  if (!process.env.DATABASE_URL) {
    const derived = buildDatabaseUrlFromDiscreteEnv();
    if (!derived) {
      throw new Error("DATABASE_URL is missing and POSTGRES_* env vars are incomplete.");
    }
    process.env.DATABASE_URL = derived;
  }

  return process.env.DATABASE_URL;
}

ensureDatabaseUrl();

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn", "error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export interface RawEventInsertInput {
  sourceId: string;
  syncRunId: string;
  uploadId: string;
  rawBlobUri: string;
  rawMimeType: string;
  rawRecordLocator: string;
  schemaVersion: number;
  payload: Record<string, unknown>;
  externalId: string | null;
  contentHash: string;
}

export type ParseRunStats = Prisma.InputJsonObject & {
  total_records: number;
  inserted_records: number;
  duplicate_records: number;
  file_name: string;
  raw_mime_type: string;
  parse_mode: "inline" | "queued";
  pipeline: "extract->normalize";
  parse_duration_ms: number;
};

export type SyncRunStatusValue = "queued" | "running" | "succeeded" | "failed" | "partial";

const MANUAL_SOURCE_NAME = "Manual Upload";
const MANUAL_SOURCE_KIND = "manual_upload";

export async function resolveOrCreateSourceId(sourceId?: string | null): Promise<string> {
  if (sourceId) {
    const source = await prisma.source.findFirst({
      where: {
        id: sourceId,
        isActive: true
      },
      select: {
        id: true
      }
    });

    if (!source) {
      throw new Error("source_id was not found or is inactive.");
    }

    return source.id;
  }

  const existing = await prisma.source.findFirst({
    where: {
      kind: MANUAL_SOURCE_KIND,
      isActive: true
    },
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true
    }
  });

  if (existing) {
    return existing.id;
  }

  const created = await prisma.source.create({
    data: {
      name: MANUAL_SOURCE_NAME,
      kind: MANUAL_SOURCE_KIND,
      config: {
        managed_by: "upload_api"
      }
    },
    select: {
      id: true
    }
  });

  return created.id;
}

export async function createQueuedSyncRun(
  sourceId: string,
  externalId: string | null
): Promise<{ id: string; status: string }> {
  return prisma.syncRun.create({
    data: {
      sourceId,
      status: "queued",
      stats: {
        external_id: externalId
      }
    },
    select: {
      id: true,
      status: true
    }
  });
}

export async function markSyncRunRunning(syncRunId: string): Promise<void> {
  await prisma.syncRun.update({
    where: { id: syncRunId },
    data: {
      status: "running",
      startedAt: new Date()
    }
  });
}

export async function markSyncRunFailed(syncRunId: string, error: unknown): Promise<void> {
  const normalized =
    error instanceof Error
      ? {
          name: error.name,
          message: error.message
        }
      : {
          name: "Error",
          message: String(error)
        };

  await prisma.syncRun.update({
    where: { id: syncRunId },
    data: {
      status: "failed",
      startedAt: new Date(),
      finishedAt: new Date(),
      error: normalized as Prisma.InputJsonValue
    }
  });
}

export async function markSyncRunCompleted(syncRunId: string, stats: ParseRunStats): Promise<void> {
  await prisma.syncRun.update({
    where: { id: syncRunId },
    data: {
      status: "succeeded",
      finishedAt: new Date(),
      stats,
      error: Prisma.JsonNull
    }
  });
}

export async function insertRawEvents(records: RawEventInsertInput[]): Promise<number> {
  if (records.length === 0) {
    return 0;
  }

  const result = await prisma.rawEvent.createMany({
    data: records.map((record) => ({
      sourceId: record.sourceId,
      syncRunId: record.syncRunId,
      uploadId: record.uploadId,
      rawBlobUri: record.rawBlobUri,
      rawMimeType: record.rawMimeType,
      rawRecordLocator: record.rawRecordLocator,
      schemaVersion: record.schemaVersion,
      payload: record.payload as Prisma.InputJsonObject,
      externalId: record.externalId,
      contentHash: record.contentHash,
      parseStatus: "parsed",
      parseError: Prisma.JsonNull
    })),
    skipDuplicates: true
  });

  return result.count;
}

export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
