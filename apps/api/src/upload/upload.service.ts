import { randomUUID } from "node:crypto";
import { Injectable, InternalServerErrorException } from "@nestjs/common";
import {
  createQueuedSyncRun,
  insertRawEvents,
  markSyncRunCompleted,
  markSyncRunFailed,
  markSyncRunRunning,
  resolveOrCreateSourceId,
  type ParseRunStats,
  type RawEventInsertInput
} from "@tail-core/db";
import {
  UPLOAD_PARSE_QUEUE,
  buildUploadObjectKey,
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

export interface UploadResponse {
  upload_id: string;
  sync_run_id: string;
  status: "queued" | "succeeded";
  counts: UploadCounts;
}

interface InlineProcessInput {
  sourceId: string;
  syncRunId: string;
  uploadId: string;
  rawBlobUri: string;
  externalId: string | null;
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
    const syncRun = await createQueuedSyncRun(resolvedSourceId, normalizedExternalId);

    const uploadId = randomUUID();
    const objectKey = buildUploadObjectKey(resolvedSourceId, uploadId, file.originalname);

    let rawBlobUri: string;
    try {
      rawBlobUri = await uploadObjectBytes(objectKey, file.buffer, file.mimetype || "application/octet-stream");
    } catch (error) {
      await markSyncRunFailed(syncRun.id, error);
      captureException(error);
      throw new InternalServerErrorException("Failed to store upload bytes.");
    }

    const parseInline = shouldParseInline((process.env.APP_ENV ?? "dev") === "dev");

    if (parseInline) {
      return this.processInline({
        sourceId: resolvedSourceId,
        syncRunId: syncRun.id,
        uploadId,
        rawBlobUri,
        externalId: normalizedExternalId,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        fileBuffer: file.buffer,
        parseMode: "inline"
      });
    }

    const jobData: UploadParseJobData = {
      sourceId: resolvedSourceId,
      syncRunId: syncRun.id,
      uploadId,
      externalId: normalizedExternalId,
      originalFilename: file.originalname,
      objectKey,
      rawBlobUri,
      mimeType: file.mimetype || "application/octet-stream"
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
      }
    };
  }

  async processInline(input: InlineProcessInput): Promise<UploadResponse> {
    const startedAt = Date.now();
    await markSyncRunRunning(input.syncRunId);

    try {
      const extracted = extractUpload(input.fileBuffer, input.mimeType, input.originalFilename);
      const normalized = normalizeExtractedRecords(
        extracted,
        input.sourceId,
        input.syncRunId,
        input.originalFilename
      );

      const inserts: RawEventInsertInput[] = normalized.records.map((record) => ({
        sourceId: input.sourceId,
        syncRunId: input.syncRunId,
        uploadId: input.uploadId,
        rawBlobUri: input.rawBlobUri,
        rawMimeType: normalized.rawMimeType,
        rawRecordLocator: record.rawRecordLocator,
        schemaVersion: 1,
        payload: record.payload,
        externalId: input.externalId,
        contentHash: record.contentHash
      }));

      const insertedCount = await insertRawEvents(inserts);
      const totalCount = inserts.length;
      const duplicateCount = totalCount - insertedCount;

      const stats: ParseRunStats = {
        total_records: totalCount,
        inserted_records: insertedCount,
        duplicate_records: duplicateCount,
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
        }
      };
    } catch (error) {
      await markSyncRunFailed(input.syncRunId, error);
      captureException(error);
      throw new InternalServerErrorException("Upload parsing failed.");
    }
  }
}
