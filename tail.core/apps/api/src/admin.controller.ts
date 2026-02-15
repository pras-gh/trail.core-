import { Prisma } from "@prisma/client";
import { BadRequestException, Controller, Get, NotFoundException, Param, Query } from "@nestjs/common";
import { getAdminOverview, prisma, type AdminOverview } from "@tail-core/db";
import { deriveNormalizedTransactionsFromRows, extractUpload, normalizeExtractedRecords } from "@tail-core/ingest";
import { downloadObjectBytes, objectKeyFromStorageUri } from "@tail-core/runtime";

interface AdminOverviewQuery {
  limit?: string;
}

interface AdminNormalizedListQuery {
  from?: string;
  to?: string;
  min_amount?: string;
  max_amount?: string;
  limit?: string;
}

interface AdminRowDetailQuery {
  upload_id?: string;
}

type RawStatusChip = "RAW_INSERTED" | "RAW_DUPLICATE" | "RAW_PENDING";
type NormalizedStatusChip = "NORMALIZED_EXISTS" | "NORMALIZED_MISSING";

interface UploadDetailRow {
  row_index: number;
  row_sha256: string;
  raw_status: RawStatusChip;
  normalized_status: NormalizedStatusChip;
  date: string | null;
  amount: string | null;
  currency: string | null;
  description: string | null;
}

interface UploadDetailResponse {
  upload: {
    id: string;
    filename: string;
    uploaded_at: string;
    source_id: string;
    source_system: string;
    source_name: string;
    source_kind: string;
    content_sha256: string;
    raw_blob_uri: string;
    raw_mime_type: string;
    sync_run_id: string;
    sync_run_status: string;
  };
  summary: {
    attempted_rows: number;
    inserted_rows: number;
    duplicate_rows: number;
    pending_rows: number;
    normalized_exists: number;
    normalized_missing: number;
  };
  raw_rows: UploadDetailRow[];
}

interface RowDetailResponse {
  row: {
    id: string;
    source_system: string;
    row_sha256: string;
    row_index: number;
    upload_id: string;
    upload_filename: string;
    uploaded_at: string;
    source_id: string;
    source_name: string;
    sync_run_id: string;
    created_at: string;
    raw_json: Record<string, unknown>;
  };
  normalized_transaction: {
    id: string;
    occurred_at: string | null;
    amount: string;
    currency: string;
    description: string;
    merchant: string | null;
    account_id: string | null;
    category: string | null;
    normalization_version: string;
    created_at: string;
  } | null;
  status: {
    raw: RawStatusChip;
    normalized: NormalizedStatusChip;
  };
}

interface NormalizedTransactionListItem {
  id: string;
  row_sha256: string;
  occurred_at: string | null;
  amount: string;
  currency: string;
  description: string;
  merchant: string | null;
  account_id: string | null;
  category: string | null;
  normalization_version: string;
  source_name: string;
  upload_id: string;
  created_at: string;
}

function asIsoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function parseDateFilter(value: string | undefined, fieldName: string): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${fieldName} must be a valid ISO date/datetime.`);
  }

  return parsed;
}

function parseAmountFilter(value: string | undefined, fieldName: string): Prisma.Decimal | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new Prisma.Decimal(value);
  } catch {
    throw new BadRequestException(`${fieldName} must be a valid decimal number.`);
  }
}

@Controller("admin")
export class AdminController {
  @Get("overview")
  async getOverview(@Query() query: AdminOverviewQuery): Promise<AdminOverview> {
    const parsedLimit = Number(query.limit ?? "12");
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 12;
    return getAdminOverview(limit);
  }

  @Get("uploads/:uploadId")
  async getUploadDetail(@Param("uploadId") uploadId: string): Promise<UploadDetailResponse> {
    const upload = await prisma.rawUpload.findUnique({
      where: {
        id: uploadId
      },
      select: {
        id: true,
        sourceId: true,
        sourceSystem: true,
        syncRunId: true,
        filename: true,
        contentSha256: true,
        rawBlobUri: true,
        rawMimeType: true,
        uploadedAt: true,
        source: {
          select: {
            name: true,
            kind: true
          }
        },
        syncRun: {
          select: {
            status: true
          }
        }
      }
    });

    if (!upload) {
      throw new NotFoundException("Upload not found.");
    }

    const objectKey = objectKeyFromStorageUri(upload.rawBlobUri);
    const fileBuffer = await downloadObjectBytes(objectKey);
    const extracted = extractUpload(fileBuffer, upload.rawMimeType, upload.filename);
    const normalizedRows = normalizeExtractedRecords(extracted);
    const normalizedCandidates = deriveNormalizedTransactionsFromRows(normalizedRows.records, {
      normalizationVersion: "v1",
      defaultCurrency: process.env.DEFAULT_TRANSACTION_CURRENCY ?? "INR"
    });

    const shaSet = Array.from(new Set(normalizedRows.records.map((record) => record.rowSha256)));
    const existingRows = await prisma.rawRow.findMany({
      where: {
        sourceSystem: upload.sourceSystem,
        rowSha256: {
          in: shaSet
        }
      },
      select: {
        rowSha256: true,
        uploadId: true,
        normalizedTransactions: {
          where: {
            normalizationVersion: "v1"
          },
          select: {
            id: true
          },
          take: 1
        }
      }
    });

    const existingBySha = new Map(existingRows.map((row) => [row.rowSha256, row]));
    const candidateBySha = new Map(normalizedCandidates.map((candidate) => [candidate.rowSha256, candidate]));

    let insertedRows = 0;
    let duplicateRows = 0;
    let pendingRows = 0;
    let normalizedExists = 0;
    let normalizedMissing = 0;

    const rawRows: UploadDetailRow[] = normalizedRows.records
      .slice()
      .sort((left, right) => left.rowIndex - right.rowIndex)
      .map((row) => {
        const existing = existingBySha.get(row.rowSha256);
        const candidate = candidateBySha.get(row.rowSha256);

        let rawStatus: RawStatusChip = "RAW_PENDING";
        if (existing) {
          rawStatus = existing.uploadId === upload.id ? "RAW_INSERTED" : "RAW_DUPLICATE";
        }

        const normalizedStatus: NormalizedStatusChip =
          existing && existing.normalizedTransactions.length > 0 ? "NORMALIZED_EXISTS" : "NORMALIZED_MISSING";

        if (rawStatus === "RAW_INSERTED") {
          insertedRows += 1;
        } else if (rawStatus === "RAW_DUPLICATE") {
          duplicateRows += 1;
        } else {
          pendingRows += 1;
        }

        if (normalizedStatus === "NORMALIZED_EXISTS") {
          normalizedExists += 1;
        } else {
          normalizedMissing += 1;
        }

        return {
          row_index: row.rowIndex,
          row_sha256: row.rowSha256,
          raw_status: rawStatus,
          normalized_status: normalizedStatus,
          date: candidate?.occurredAt ?? null,
          amount: candidate ? `${candidate.currency} ${candidate.amount}` : null,
          currency: candidate?.currency ?? null,
          description: candidate?.description ?? null
        };
      });

    return {
      upload: {
        id: upload.id,
        filename: upload.filename,
        uploaded_at: upload.uploadedAt.toISOString(),
        source_id: upload.sourceId,
        source_system: upload.sourceSystem,
        source_name: upload.source.name,
        source_kind: upload.source.kind,
        content_sha256: upload.contentSha256,
        raw_blob_uri: upload.rawBlobUri,
        raw_mime_type: upload.rawMimeType,
        sync_run_id: upload.syncRunId,
        sync_run_status: upload.syncRun.status
      },
      summary: {
        attempted_rows: rawRows.length,
        inserted_rows: insertedRows,
        duplicate_rows: duplicateRows,
        pending_rows: pendingRows,
        normalized_exists: normalizedExists,
        normalized_missing: normalizedMissing
      },
      raw_rows: rawRows
    };
  }

  @Get("rows/:rowSha256")
  async getRowDetail(
    @Param("rowSha256") rowSha256: string,
    @Query() query: AdminRowDetailQuery
  ): Promise<RowDetailResponse> {
    const attemptedUploadId = query.upload_id?.trim();
    let whereClause: Prisma.RawRowWhereInput;

    if (attemptedUploadId && attemptedUploadId.length > 0) {
      whereClause = {
        rowSha256,
        uploadId: attemptedUploadId
      };
    } else {
      const matches = await prisma.rawRow.findMany({
        where: {
          rowSha256
        },
        orderBy: {
          createdAt: "asc"
        },
        take: 2,
        select: {
          id: true
        }
      });

      if (matches.length === 0) {
        throw new NotFoundException("Raw row not found.");
      }

      if (matches.length > 1) {
        throw new BadRequestException("row_sha256 is ambiguous across source_system values; provide upload_id.");
      }

      const selected = matches[0];
      if (!selected) {
        throw new NotFoundException("Raw row not found.");
      }

      whereClause = {
        id: selected.id
      };
    }

    const row = await prisma.rawRow.findFirst({
      where: whereClause,
      select: {
        id: true,
        sourceSystem: true,
        rowSha256: true,
        rowIndex: true,
        rawJson: true,
        createdAt: true,
        uploadId: true,
        upload: {
          select: {
            id: true,
            filename: true,
            uploadedAt: true,
            sourceId: true,
            syncRunId: true,
            source: {
              select: {
                name: true
              }
            }
          }
        },
        normalizedTransactions: {
          where: {
            normalizationVersion: "v1"
          },
          orderBy: {
            createdAt: "desc"
          },
          take: 1,
          select: {
            id: true,
            occurredAt: true,
            amount: true,
            currency: true,
            description: true,
            merchant: true,
            accountId: true,
            category: true,
            normalizationVersion: true,
            createdAt: true
          }
        }
      }
    });

    if (!row) {
      throw new NotFoundException(
        attemptedUploadId && attemptedUploadId.length > 0
          ? "Raw row not found for provided row_sha256 + upload_id."
          : "Raw row not found."
      );
    }

    const rawStatus: RawStatusChip =
      attemptedUploadId && attemptedUploadId.length > 0 && attemptedUploadId !== row.uploadId
        ? "RAW_DUPLICATE"
        : "RAW_INSERTED";

    const normalized = row.normalizedTransactions[0] ?? null;
    const normalizedStatus: NormalizedStatusChip = normalized ? "NORMALIZED_EXISTS" : "NORMALIZED_MISSING";

    return {
      row: {
        id: row.id,
        source_system: row.sourceSystem,
        row_sha256: row.rowSha256,
        row_index: row.rowIndex,
        upload_id: row.upload.id,
        upload_filename: row.upload.filename,
        uploaded_at: row.upload.uploadedAt.toISOString(),
        source_id: row.upload.sourceId,
        source_name: row.upload.source.name,
        sync_run_id: row.upload.syncRunId,
        created_at: row.createdAt.toISOString(),
        raw_json: row.rawJson as Record<string, unknown>
      },
      normalized_transaction: normalized
        ? {
            id: normalized.id,
            occurred_at: asIsoOrNull(normalized.occurredAt),
            amount: normalized.amount.toString(),
            currency: normalized.currency,
            description: normalized.description,
            merchant: normalized.merchant,
            account_id: normalized.accountId,
            category: normalized.category,
            normalization_version: normalized.normalizationVersion,
            created_at: normalized.createdAt.toISOString()
          }
        : null,
      status: {
        raw: rawStatus,
        normalized: normalizedStatus
      }
    };
  }

  @Get("normalized-transactions")
  async listNormalizedTransactions(
    @Query() query: AdminNormalizedListQuery
  ): Promise<{ total: number; items: NormalizedTransactionListItem[] }> {
    const parsedLimit = Number(query.limit ?? "50");
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(200, Math.floor(parsedLimit))) : 50;
    const from = parseDateFilter(query.from, "from");
    const to = parseDateFilter(query.to, "to");
    const minAmount = parseAmountFilter(query.min_amount, "min_amount");
    const maxAmount = parseAmountFilter(query.max_amount, "max_amount");

    const where: Prisma.NormalizedTransactionWhereInput = {};

    if (from || to) {
      where.occurredAt = {
        gte: from,
        lte: to
      };
    }

    if (minAmount || maxAmount) {
      where.amount = {
        gte: minAmount,
        lte: maxAmount
      };
    }

    const [total, items] = await Promise.all([
      prisma.normalizedTransaction.count({
        where
      }),
      prisma.normalizedTransaction.findMany({
        where,
        orderBy: [
          {
            occurredAt: "desc"
          },
          {
            createdAt: "desc"
          }
        ],
        take: limit,
        select: {
          id: true,
          rowSha256: true,
          occurredAt: true,
          amount: true,
          currency: true,
          description: true,
          merchant: true,
          accountId: true,
          category: true,
          normalizationVersion: true,
          createdAt: true,
          rawRow: {
            select: {
              uploadId: true,
              upload: {
                select: {
                  source: {
                    select: {
                      name: true
                    }
                  }
                }
              }
            }
          }
        }
      })
    ]);

    return {
      total,
      items: items.map((item) => ({
        id: item.id,
        row_sha256: item.rowSha256,
        occurred_at: asIsoOrNull(item.occurredAt),
        amount: item.amount.toString(),
        currency: item.currency,
        description: item.description,
        merchant: item.merchant,
        account_id: item.accountId,
        category: item.category,
        normalization_version: item.normalizationVersion,
        source_name: item.rawRow.upload.source.name,
        upload_id: item.rawRow.uploadId,
        created_at: item.createdAt.toISOString()
      }))
    };
  }
}
