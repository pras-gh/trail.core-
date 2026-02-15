import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface IngestionRunResult {
  uploadId: string;
  syncRunId: string;
  totalRows: number;
  rawInserted: number;
  rawDuplicates: number;
  normalizedCandidates: number;
  normalizedInserted: number;
  rowShas: string[];
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function loadEnvFile(relativePath: string): void {
  const filePath = resolve(process.cwd(), relativePath);
  if (!existsSync(filePath)) {
    return;
  }

  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator < 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function sha256Hex(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function main(): Promise<void> {
  loadEnvFile("env/dev.env");

  const db = await import("../packages/db/src/index.ts");
  const ingest = await import("../packages/ingest/src/index.ts");

  const {
    createQueuedSyncRun,
    createRawUpload,
    insertNormalizedTransactions,
    insertRawRows,
    markSyncRunCompleted,
    markSyncRunFailed,
    markSyncRunRunning,
    pingDatabase,
    prisma,
    resolveOrCreateSourceId,
    resolveSourceSystem
  } = db;

  await pingDatabase();

  const sourceId = await resolveOrCreateSourceId();
  const sourceSystem = await resolveSourceSystem(sourceId);
  const testRunId = randomUUID();
  const filename = "acceptance-idempotency.csv";

  const csvContent = [
    "date,amount,currency,description,merchant,account_id,category,test_run_id",
    `2026-02-15,1200.50,INR,Salary Credit,ACME Corp,acc_main,income,${testRunId}`,
    `2026-02-16,-245.10,INR,UPI Grocery,Fresh Mart,acc_main,food,${testRunId}`,
    `2026-02-17,-99.99,INR,Mobile Recharge,Jio,acc_main,utilities,${testRunId}`
  ].join("\n");
  const fileBuffer = Buffer.from(csvContent, "utf8");

  async function runOneIngestion(params: {
    sourceId: string;
    sourceSystem: string;
    fileBuffer: Buffer;
    filename: string;
    externalId: string | null;
    testRunId: string;
  }): Promise<IngestionRunResult> {
    const syncRun = await createQueuedSyncRun(params.sourceId, params.externalId);
    const uploadId = randomUUID();

    try {
      await markSyncRunRunning(syncRun.id);

      await createRawUpload({
        id: uploadId,
        sourceId: params.sourceId,
        syncRunId: syncRun.id,
        sourceSystem: params.sourceSystem,
        filename: params.filename,
        contentSha256: sha256Hex(params.fileBuffer),
        rawBlobUri: `s3://tail-core-acceptance/${params.testRunId}/${uploadId}/${params.filename}`,
        rawMimeType: "text/csv"
      });

      const extracted = ingest.extractUpload(params.fileBuffer, "text/csv", params.filename);
      const normalized = ingest.normalizeExtractedRecords(extracted);
      const normalizedCandidates = ingest.deriveNormalizedTransactionsFromRows(normalized.records, {
        normalizationVersion: "v1",
        defaultCurrency: process.env.DEFAULT_TRANSACTION_CURRENCY ?? "INR"
      });

      const rawRows = normalized.records.map((record) => ({
        uploadId,
        sourceSystem: params.sourceSystem,
        rowIndex: record.rowIndex,
        rawJson: record.rawJson,
        rowSha256: record.rowSha256
      }));

      const normalizedRows = normalizedCandidates.map((candidate) => ({
        sourceSystem: params.sourceSystem,
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

      const rawInserted = await insertRawRows(rawRows);
      const normalizedInserted = await insertNormalizedTransactions(normalizedRows);

      const stats = {
        total_records: rawRows.length,
        inserted_records: rawInserted,
        duplicate_records: rawRows.length - rawInserted,
        normalized_candidate_records: normalizedRows.length,
        normalized_inserted_records: normalizedInserted,
        file_name: params.filename,
        raw_mime_type: "text/csv",
        parse_mode: "inline",
        pipeline: "extract->normalize",
        parse_duration_ms: 0
      };

      await markSyncRunCompleted(syncRun.id, stats);

      return {
        uploadId,
        syncRunId: syncRun.id,
        totalRows: rawRows.length,
        rawInserted,
        rawDuplicates: rawRows.length - rawInserted,
        normalizedCandidates: normalizedRows.length,
        normalizedInserted,
        rowShas: rawRows.map((row) => row.rowSha256)
      };
    } catch (error) {
      await markSyncRunFailed(syncRun.id, error);
      throw error;
    }
  }

  const baselineRawCount = await prisma.rawRow.count();
  const baselineNormalizedCount = await prisma.normalizedTransaction.count();

  const firstRun = await runOneIngestion({
    sourceId,
    sourceSystem,
    fileBuffer,
    filename,
    externalId: `acceptance-${testRunId}-1`,
    testRunId
  });

  const afterFirstRawCount = await prisma.rawRow.count();
  const afterFirstNormalizedCount = await prisma.normalizedTransaction.count();

  const secondRun = await runOneIngestion({
    sourceId,
    sourceSystem,
    fileBuffer,
    filename,
    externalId: `acceptance-${testRunId}-2`,
    testRunId
  });

  const afterSecondRawCount = await prisma.rawRow.count();
  const afterSecondNormalizedCount = await prisma.normalizedTransaction.count();

  const expectedRows = 3;

  assert(firstRun.totalRows === expectedRows, `Expected ${expectedRows} parsed rows, got ${firstRun.totalRows}.`);
  assert(
    firstRun.normalizedCandidates === expectedRows,
    `Expected ${expectedRows} normalized candidates, got ${firstRun.normalizedCandidates}.`
  );
  assert(firstRun.rawInserted === expectedRows, `First run should insert ${expectedRows} raw rows.`);
  assert(
    firstRun.normalizedInserted === expectedRows,
    `First run should insert ${expectedRows} normalized rows, got ${firstRun.normalizedInserted}.`
  );

  assert(secondRun.rawInserted === 0, `Second run should insert 0 raw rows, got ${secondRun.rawInserted}.`);
  assert(
    secondRun.normalizedInserted === 0,
    `Second run should insert 0 normalized rows, got ${secondRun.normalizedInserted}.`
  );
  assert(
    secondRun.rawDuplicates === expectedRows,
    `Second run should report ${expectedRows} duplicates, got ${secondRun.rawDuplicates}.`
  );

  assert(
    afterFirstRawCount - baselineRawCount === expectedRows,
    "Raw row count did not increase by expected rows after first run."
  );
  assert(
    afterFirstNormalizedCount - baselineNormalizedCount === expectedRows,
    "Normalized transaction count did not increase by expected rows after first run."
  );

  assert(afterSecondRawCount === afterFirstRawCount, "Raw row count changed on second run.");
  assert(
    afterSecondNormalizedCount === afterFirstNormalizedCount,
    "Normalized transaction count changed on second run."
  );

  const persistedRawRows = await prisma.rawRow.count({
    where: {
      sourceSystem,
      rowSha256: {
        in: firstRun.rowShas
      }
    }
  });

  assert(persistedRawRows === expectedRows, "Expected one persisted raw row per row_sha256.");

  const persistedNormalized = await prisma.normalizedTransaction.findMany({
    where: {
      sourceSystem,
      rowSha256: {
        in: firstRun.rowShas
      },
      normalizationVersion: "v1"
    },
    select: {
      sourceSystem: true,
      rowSha256: true,
      normalizationVersion: true
    }
  });

  assert(persistedNormalized.length === expectedRows, "Expected one persisted normalized row per input row.");

  const tupleSet = new Set<string>();
  for (const item of persistedNormalized) {
    const tuple = `${item.sourceSystem}|${item.rowSha256}|${item.normalizationVersion}`;
    assert(!tupleSet.has(tuple), `Duplicate tuple found for ${tuple}.`);
    tupleSet.add(tuple);
  }

  console.log("Acceptance idempotency test passed.");
  console.log(
    JSON.stringify(
      {
        sourceId,
        uploadIds: [firstRun.uploadId, secondRun.uploadId],
        syncRunIds: [firstRun.syncRunId, secondRun.syncRunId],
        expectedRows,
        firstRun: {
          rawInserted: firstRun.rawInserted,
          normalizedInserted: firstRun.normalizedInserted
        },
        secondRun: {
          rawInserted: secondRun.rawInserted,
          normalizedInserted: secondRun.normalizedInserted,
          duplicates: secondRun.rawDuplicates
        },
        counts: {
          rawRowsBefore: baselineRawCount,
          rawRowsAfterFirst: afterFirstRawCount,
          rawRowsAfterSecond: afterSecondRawCount,
          normalizedBefore: baselineNormalizedCount,
          normalizedAfterFirst: afterFirstNormalizedCount,
          normalizedAfterSecond: afterSecondNormalizedCount
        }
      },
      null,
      2
    )
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Acceptance idempotency test failed.");
  console.error(error);
  process.exit(1);
});
