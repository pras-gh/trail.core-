import * as Sentry from "@sentry/node";
import {
  insertRawEvents,
  markSyncRunCompleted,
  markSyncRunFailed,
  markSyncRunRunning,
  type ParseRunStats,
  type RawEventInsertInput
} from "@tail-core/db";
import {
  UPLOAD_PARSE_QUEUE,
  extractUpload,
  normalizeExtractedRecords,
  type UploadParseJobData
} from "@tail-core/ingest";
import { downloadObjectBytes, getRedisConnectionOptions } from "@tail-core/runtime";
import { Worker } from "bullmq";

if (process.env.SENTRY_DSN_WORKER) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN_WORKER,
    environment: process.env.APP_ENV ?? "dev",
    tracesSampleRate: 0.05
  });
}

async function processUploadJob(job: UploadParseJobData): Promise<void> {
  const startedAt = Date.now();
  await markSyncRunRunning(job.syncRunId);

  try {
    const fileBuffer = await downloadObjectBytes(job.objectKey);
    const extracted = extractUpload(fileBuffer, job.mimeType, job.originalFilename);
    const normalized = normalizeExtractedRecords(
      extracted,
      job.sourceId,
      job.syncRunId,
      job.originalFilename
    );

    const inserts: RawEventInsertInput[] = normalized.records.map((record) => ({
      sourceId: job.sourceId,
      syncRunId: job.syncRunId,
      uploadId: job.uploadId,
      rawBlobUri: job.rawBlobUri,
      rawMimeType: normalized.rawMimeType,
      rawRecordLocator: record.rawRecordLocator,
      schemaVersion: 1,
      payload: record.payload,
      externalId: job.externalId,
      contentHash: record.contentHash
    }));

    const insertedCount = await insertRawEvents(inserts);
    const totalCount = inserts.length;
    const duplicateCount = totalCount - insertedCount;

    const stats: ParseRunStats = {
      total_records: totalCount,
      inserted_records: insertedCount,
      duplicate_records: duplicateCount,
      file_name: job.originalFilename,
      raw_mime_type: normalized.rawMimeType,
      parse_mode: "queued",
      pipeline: "extract->normalize",
      parse_duration_ms: Date.now() - startedAt
    };

    await markSyncRunCompleted(job.syncRunId, stats);
  } catch (error) {
    await markSyncRunFailed(job.syncRunId, error);
    Sentry.captureException(error);
    throw error;
  }
}

const worker = new Worker<UploadParseJobData>(
  UPLOAD_PARSE_QUEUE,
  async (job) => {
    await processUploadJob(job.data);
  },
  {
    connection: getRedisConnectionOptions(),
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5)
  }
);

worker.on("ready", () => {
  console.log(`Worker ready on queue ${UPLOAD_PARSE_QUEUE}`);
});

worker.on("completed", (job) => {
  console.log(`Processed upload job ${job.id}`);
});

worker.on("failed", (job, error) => {
  console.error(`Upload job failed: ${job?.id ?? "unknown"}`, error);
});

async function shutdown(): Promise<void> {
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown();
});

process.on("SIGINT", () => {
  void shutdown();
});
