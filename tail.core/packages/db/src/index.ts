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

export interface RawUploadInsertInput {
  id: string;
  sourceId: string;
  syncRunId: string;
  sourceSystem: string;
  filename: string;
  contentSha256: string;
  rawBlobUri: string;
  rawMimeType: string;
}

export interface RawRowInsertInput {
  uploadId: string;
  sourceSystem: string;
  rowIndex: number;
  rawJson: Record<string, unknown>;
  rowSha256: string;
}

export interface NormalizedTransactionInsertInput {
  sourceSystem: string;
  rowSha256: string;
  occurredAt: string | Date | null;
  amount: string;
  currency: string;
  description: string;
  merchant: string | null;
  accountId: string | null;
  category: string | null;
  normalizationVersion: string;
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

export interface AdminMetrics {
  totalSources: number;
  activeSources: number;
  syncRunsLast24h: number;
  uploadsLast24h: number;
  rawRowsLast24h: number;
  normalizedTransactionsLast24h: number;
}

export interface AdminSyncRunSummary {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceKind: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  totalRecords: number | null;
  insertedRecords: number | null;
  duplicateRecords: number | null;
  normalizedCandidateRecords: number | null;
  normalizedInsertedRecords: number | null;
}

export interface AdminUploadSummary {
  id: string;
  sourceId: string;
  sourceSystem: string;
  sourceName: string;
  syncRunId: string;
  syncRunStatus: string;
  filename: string;
  rawMimeType: string;
  uploadedAt: string;
  rowCount: number;
}

export interface AdminOverview {
  generatedAt: string;
  metrics: AdminMetrics;
  recentSyncRuns: AdminSyncRunSummary[];
  recentUploads: AdminUploadSummary[];
}

const MANUAL_SOURCE_NAME = "Manual Upload";
const MANUAL_SOURCE_KIND = "manual_upload";

function sourceSystemToken(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : "unknown";
}

function normalizeSourceSystem(value: string): string {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (!normalized) {
    return "unknown:unknown";
  }

  const separator = normalized.indexOf(":");
  if (separator < 0) {
    return `source:${sourceSystemToken(normalized)}`;
  }

  const prefixRaw = normalized.slice(0, separator);
  const suffixRaw = normalized.slice(separator + 1);

  return `${sourceSystemToken(prefixRaw)}:${sourceSystemToken(suffixRaw)}`;
}

function sourceSystemFromSource(source: { kind: string; name: string; config: Prisma.JsonValue }): string {
  if (source.config && typeof source.config === "object" && !Array.isArray(source.config)) {
    const configured = (source.config as Record<string, unknown>).source_system;
    if (typeof configured === "string" && configured.trim().length > 0) {
      return normalizeSourceSystem(configured);
    }
  }

  return `${sourceSystemToken(source.kind)}:${sourceSystemToken(source.name)}`;
}

function parseStatNumber(stats: Prisma.JsonValue, key: string): number | null {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
    return null;
  }

  const value = (stats as Record<string, unknown>)[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

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

export async function resolveSourceSystem(sourceId: string): Promise<string> {
  const source = await prisma.source.findFirst({
    where: {
      id: sourceId,
      isActive: true
    },
    select: {
      kind: true,
      name: true,
      config: true
    }
  });

  if (!source) {
    throw new Error("source_id was not found or is inactive.");
  }

  return sourceSystemFromSource(source);
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

export async function createRawUpload(input: RawUploadInsertInput): Promise<{ id: string }> {
  return prisma.rawUpload.create({
    data: {
      id: input.id,
      sourceId: input.sourceId,
      syncRunId: input.syncRunId,
      sourceSystem: input.sourceSystem,
      filename: input.filename,
      contentSha256: input.contentSha256,
      rawBlobUri: input.rawBlobUri,
      rawMimeType: input.rawMimeType
    },
    select: {
      id: true
    }
  });
}

export async function insertRawRows(records: RawRowInsertInput[]): Promise<number> {
  if (records.length === 0) {
    return 0;
  }

  const result = await prisma.rawRow.createMany({
    data: records.map((record) => ({
      uploadId: record.uploadId,
      sourceSystem: record.sourceSystem,
      rowIndex: record.rowIndex,
      rawJson: record.rawJson as Prisma.InputJsonObject,
      rowSha256: record.rowSha256
    })),
    skipDuplicates: true
  });

  return result.count;
}

function normalizeOccurredAtForWrite(value: string | Date | null): Date | null {
  if (!value) {
    return null;
  }

  const normalized = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(normalized.getTime())) {
    throw new Error("occurredAt must be a valid ISO datetime string or Date.");
  }

  return normalized;
}

export async function insertNormalizedTransactions(
  records: NormalizedTransactionInsertInput[]
): Promise<number> {
  if (records.length === 0) {
    return 0;
  }

  const result = await prisma.normalizedTransaction.createMany({
    data: records.map((record) => ({
      sourceSystem: record.sourceSystem,
      rowSha256: record.rowSha256,
      occurredAt: normalizeOccurredAtForWrite(record.occurredAt),
      amount: new Prisma.Decimal(record.amount),
      currency: record.currency,
      description: record.description,
      merchant: record.merchant,
      accountId: record.accountId,
      category: record.category,
      normalizationVersion: record.normalizationVersion
    })),
    skipDuplicates: true
  });

  return result.count;
}

export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export async function getAdminOverview(limit = 12): Promise<AdminOverview> {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    totalSources,
    activeSources,
    syncRunsLast24h,
    uploadsLast24h,
    rawRowsLast24h,
    normalizedTransactionsLast24h,
    recentSyncRuns,
    recentUploads
  ] = await Promise.all([
    prisma.source.count(),
    prisma.source.count({
      where: {
        isActive: true
      }
    }),
    prisma.syncRun.count({
      where: {
        createdAt: {
          gte: since
        }
      }
    }),
    prisma.rawUpload.count({
      where: {
        uploadedAt: {
          gte: since
        }
      }
    }),
    prisma.rawRow.count({
      where: {
        createdAt: {
          gte: since
        }
      }
    }),
    prisma.normalizedTransaction.count({
      where: {
        createdAt: {
          gte: since
        }
      }
    }),
    prisma.syncRun.findMany({
      orderBy: {
        createdAt: "desc"
      },
      take: boundedLimit,
      select: {
        id: true,
        sourceId: true,
        status: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        stats: true,
        source: {
          select: {
            name: true,
            kind: true
          }
        }
      }
    }),
    prisma.rawUpload.findMany({
      orderBy: {
        uploadedAt: "desc"
      },
      take: boundedLimit,
      select: {
        id: true,
        sourceId: true,
        sourceSystem: true,
        syncRunId: true,
        filename: true,
        rawMimeType: true,
        uploadedAt: true,
        source: {
          select: {
            name: true
          }
        },
        syncRun: {
          select: {
            status: true
          }
        },
        _count: {
          select: {
            rawRows: true
          }
        }
      }
    })
  ]);

  return {
    generatedAt: new Date().toISOString(),
    metrics: {
      totalSources,
      activeSources,
      syncRunsLast24h,
      uploadsLast24h,
      rawRowsLast24h,
      normalizedTransactionsLast24h
    },
    recentSyncRuns: recentSyncRuns.map((run) => ({
      id: run.id,
      sourceId: run.sourceId,
      sourceName: run.source.name,
      sourceKind: run.source.kind,
      status: run.status,
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt ? run.startedAt.toISOString() : null,
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      totalRecords: parseStatNumber(run.stats, "total_records"),
      insertedRecords: parseStatNumber(run.stats, "inserted_records"),
      duplicateRecords: parseStatNumber(run.stats, "duplicate_records"),
      normalizedCandidateRecords: parseStatNumber(run.stats, "normalized_candidate_records"),
      normalizedInsertedRecords: parseStatNumber(run.stats, "normalized_inserted_records")
    })),
    recentUploads: recentUploads.map((upload) => ({
      id: upload.id,
      sourceId: upload.sourceId,
      sourceSystem: upload.sourceSystem,
      sourceName: upload.source.name,
      syncRunId: upload.syncRunId,
      syncRunStatus: upload.syncRun.status,
      filename: upload.filename,
      rawMimeType: upload.rawMimeType,
      uploadedAt: upload.uploadedAt.toISOString(),
      rowCount: upload._count.rawRows
    }))
  };
}
