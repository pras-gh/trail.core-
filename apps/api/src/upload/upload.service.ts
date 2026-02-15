import { createHash, randomUUID } from "node:crypto";
import { Injectable, InternalServerErrorException } from "@nestjs/common";
import {
  createRawUpload,
  createQueuedSyncRun,
  insertNormalizedTransactions,
  insertRawRows,
  markSyncRunCompleted,
  markSyncRunFailed,
  markSyncRunRunning,
  resolveOrCreateSourceId,
  resolveSourceSystem,
  type NormalizedTransactionInsertInput,
  type ParseRunStats,
  type RawRowInsertInput
} from "@tail-core/db";
import {
  UPLOAD_PARSE_QUEUE,
  buildUploadObjectKey,
  deriveNormalizedTransactionsFromRows,
  extractUpload,
  normalizeExtractedRecords,
  type UploadParseJobData
} from "@tail-core/ingest";
import { getRedisConnectionOptions, shouldParseInline, uploadObjectBytes } from "@tail-core/runtime";
import { Queue } from "bullmq";
import { captureException } from "../sentry.js";

export interface UploadCounts {
  total: number;
  inserted: number;
  duplicates: number;
}

export interface NormalizedTransactionResponse {
  row_sha256: string;
  occurred_at: string | null;
  amount: string;
  currency: string;
  description: string;
  merchant: string | null;
  account_id: string | null;
  category: string | null;
  normalization_version: string;
}

export interface UploadResponse {
  upload_id: string;
  sync_run_id: string;
  status: "queued" | "succeeded";
  counts: UploadCounts;
  normalized_transactions: NormalizedTransactionResponse[];
}

interface InlineProcessInput {
  sourceSystem: string;
  syncRunId: string;
  uploadId: string;
  originalFilename: string;
  mimeType: string;
  fileBuffer: Buffer;
  parseMode: "inline" | "queued";
}

function normalizeOptional(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hashBufferSha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

@Injectable()
export class UploadService {
  private readonly queue = new Queue<UploadParseJobData>(UPLOAD_PARSE_QUEUE, {
    connection: getRedisConnectionOptions()
  });

  async handleUpload(
    file: Express.Multer.File,
    sourceId: string | undefined,
    externalId: string | undefined
  ): Promise<UploadResponse> {
    const normalizedSourceId = normalizeOptional(sourceId);
    const normalizedExternalId = normalizeOptional(externalId);

    const resolvedSourceId = await resolveOrCreateSourceId(normalizedSourceId);
    const sourceSystem = await resolveSourceSystem(resolvedSourceId);
    const syncRun = await createQueuedSyncRun(resolvedSourceId, normalizedExternalId);

    const uploadId = randomUUID();
    const rawMimeType = file.mimetype || "application/octet-stream";
    const contentSha256 = hashBufferSha256(file.buffer);
    const objectKey = buildUploadObjectKey(resolvedSourceId, uploadId, file.originalname);

    let rawBlobUri: string;
    try {
      rawBlobUri = await uploadObjectBytes(objectKey, file.buffer, rawMimeType);
    } catch (error) {
      await markSyncRunFailed(syncRun.id, error);
      captureException(error);
      throw new InternalServerErrorException("Failed to store upload bytes.");
    }

    try {
      await createRawUpload({
        id: uploadId,
        sourceId: resolvedSourceId,
        syncRunId: syncRun.id,
        sourceSystem,
        filename: file.originalname,
        contentSha256,
        rawBlobUri,
        rawMimeType
      });
    } catch (error) {
      await markSyncRunFailed(syncRun.id, error);
      captureException(error);
      throw new InternalServerErrorException("Failed to persist upload metadata.");
    }

    const parseInline = shouldParseInline((process.env.APP_ENV ?? "dev") === "dev");

    if (parseInline) {
      return this.processInline({
        sourceSystem,
        syncRunId: syncRun.id,
        uploadId,
        originalFilename: file.originalname,
        mimeType: rawMimeType,
        fileBuffer: file.buffer,
        parseMode: "inline"
      });
    }

    const jobData: UploadParseJobData = {
      sourceId: resolvedSourceId,
      sourceSystem,
      syncRunId: syncRun.id,
      uploadId,
      externalId: normalizedExternalId,
      originalFilename: file.originalname,
      objectKey,
      mimeType: rawMimeType
    };

    try {
      await this.queue.add("parse-upload", jobData, {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000
        },
        removeOnComplete: {
          count: 500
        },
        removeOnFail: {
          count: 500
        }
      });
    } catch (error) {
      await markSyncRunFailed(syncRun.id, error);
      captureException(error);
      throw new InternalServerErrorException("Failed to enqueue parse job.");
    }

    return {
      upload_id: uploadId,
      sync_run_id: syncRun.id,
      status: "queued",
      counts: {
        total: 0,
        inserted: 0,
        duplicates: 0
      },
      normalized_transactions: []
    };
  }

  async processInline(input: InlineProcessInput): Promise<UploadResponse> {
    const startedAt = Date.now();
    await markSyncRunRunning(input.syncRunId);

    try {
      const extracted = extractUpload(input.fileBuffer, input.mimeType, input.originalFilename);
      const normalized = normalizeExtractedRecords(extracted);

      const inserts: RawRowInsertInput[] = normalized.records.map((record) => ({
        uploadId: input.uploadId,
        sourceSystem: input.sourceSystem,
        rowIndex: record.rowIndex,
        rawJson: record.rawJson,
        rowSha256: record.rowSha256
      }));

      const insertedCount = await insertRawRows(inserts);
      const totalCount = inserts.length;
      const duplicateCount = totalCount - insertedCount;
      const normalizedCandidates = deriveNormalizedTransactionsFromRows(normalized.records, {
        normalizationVersion: "v1",
        defaultCurrency: process.env.DEFAULT_TRANSACTION_CURRENCY ?? "INR"
      });
      const normalizedInserts: NormalizedTransactionInsertInput[] = normalizedCandidates.map((candidate) => ({
        sourceSystem: input.sourceSystem,
        rowSha256: candidate.rowSha256,
        occurredAt: candidate.occurredAt,
        amount: candidate.amount,
        currency: candidate.currency,
        description: candidate.description,
        merchant: candidate.merchant,
        accountId: candidate.accountId,
        category: candidate.category,
        normalizationVersion: candidate.normalizationVersion
      }));
      const normalizedInsertedCount = await insertNormalizedTransactions(normalizedInserts);
      const normalizedResponse: NormalizedTransactionResponse[] = normalizedCandidates.map((candidate) => ({
        row_sha256: candidate.rowSha256,
        occurred_at: candidate.occurredAt,
        amount: candidate.amount,
        currency: candidate.currency,
        description: candidate.description,
        merchant: candidate.merchant,
        account_id: candidate.accountId,
        category: candidate.category,
        normalization_version: candidate.normalizationVersion
      }));

      const stats: ParseRunStats = {
        total_records: totalCount,
        inserted_records: insertedCount,
        duplicate_records: duplicateCount,
        normalized_candidate_records: normalizedInserts.length,
        normalized_inserted_records: normalizedInsertedCount,
        file_name: input.originalFilename,
        raw_mime_type: normalized.rawMimeType,
        parse_mode: input.parseMode,
        pipeline: "extract->normalize",
        parse_duration_ms: Date.now() - startedAt
      };

      await markSyncRunCompleted(input.syncRunId, stats);

      return {
        upload_id: input.uploadId,
        sync_run_id: input.syncRunId,
        status: "succeeded",
        counts: {
          total: totalCount,
          inserted: insertedCount,
          duplicates: duplicateCount
        },
        normalized_transactions: normalizedResponse
      };
    } catch (error) {
      await markSyncRunFailed(input.syncRunId, error);
      captureException(error);
      throw new InternalServerErrorException("Upload parsing failed.");
    }
  }
}
