import { createHash } from "node:crypto";
import { extname, basename } from "node:path";
import { parse as parseCsv } from "csv-parse/sync";

export const UPLOAD_PARSE_QUEUE = "upload-parse";

export interface UploadParseJobData {
  sourceId: string;
  syncRunId: string;
  uploadId: string;
  externalId: string | null;
  originalFilename: string;
  objectKey: string;
  rawBlobUri: string;
  mimeType: string;
}

export interface ExtractedRecord {
  basePayload: Record<string, unknown>;
  locator: string;
  extractionMeta: Record<string, unknown>;
  hashMaterial: unknown;
}

export interface ExtractedResult {
  rawMimeType: string;
  records: ExtractedRecord[];
}

export interface NormalizedRecord {
  payload: Record<string, unknown>;
  rawRecordLocator: string;
  contentHash: string;
}

export interface NormalizedResult {
  rawMimeType: string;
  records: NormalizedRecord[];
}

function hashSha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableSerialize(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const keys = Object.keys(objectValue).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(objectValue[key])}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(String(value));
}

function normalizeText(content: string): string {
  return content.replace(/\u0000/g, " ").replace(/\s+/g, " ").trim();
}

function detectUploadKind(mimeType: string, originalFilename: string): "csv" | "pdf" | null {
  const normalizedMimeType = (mimeType || "").toLowerCase();
  const extension = extname(originalFilename || "").toLowerCase();

  if (normalizedMimeType === "text/csv" || extension === ".csv") {
    return "csv";
  }

  if (normalizedMimeType === "application/pdf" || extension === ".pdf") {
    return "pdf";
  }

  return null;
}

export function isSupportedUploadFile(mimeType: string, originalFilename: string): boolean {
  return detectUploadKind(mimeType, originalFilename) !== null;
}

function extractCsv(fileBuffer: Buffer): ExtractedResult {
  const text = fileBuffer.toString("utf8");
  const rows = parseCsv(text, {
    columns: false,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true
  }) as string[][];

  if (rows.length === 0) {
    return { rawMimeType: "text/csv", records: [] };
  }

  const headerRow = rows[0] ?? [];
  const headers = headerRow.map((value, index) => {
    const preserved = String(value ?? "");
    return preserved.length > 0 ? preserved : `column_${index + 1}`;
  });

  const headerMapping = {
    columns: headers.map((name, index) => ({
      index,
      name
    }))
  };

  const records = rows.slice(1).map((values, index) => {
    const rowNumber = index + 2;
    const rowPayload: Record<string, unknown> = {};

    headers.forEach((headerName, headerIndex) => {
      rowPayload[headerName] = values[headerIndex] ?? null;
    });

    const locator = `row:${rowNumber}`;

    return {
      basePayload: rowPayload,
      locator,
      extractionMeta: {
        row: rowNumber,
        header_mapping: headerMapping
      },
      hashMaterial: {
        row: rowPayload,
        header_mapping: headerMapping,
        locator
      }
    } satisfies ExtractedRecord;
  });

  return {
    rawMimeType: "text/csv",
    records
  };
}

function extractPdfStub(fileBuffer: Buffer): ExtractedResult {
  const text = normalizeText(fileBuffer.toString("utf8")).slice(0, 4000);
  const extractedText = text || "[pdf-content-not-extracted]";
  const locator = "document:1";

  return {
    rawMimeType: "application/pdf",
    records: [
      {
        basePayload: {
          text: extractedText
        },
        locator,
        extractionMeta: {
          stub: true,
          page: 1
        },
        hashMaterial: {
          extracted_text: extractedText,
          locator
        }
      }
    ]
  };
}

export function extractUpload(fileBuffer: Buffer, mimeType: string, originalFilename: string): ExtractedResult {
  const kind = detectUploadKind(mimeType, originalFilename);

  if (kind === "csv") {
    return extractCsv(fileBuffer);
  }

  if (kind === "pdf") {
    return extractPdfStub(fileBuffer);
  }

  throw new Error("Only CSV and PDF uploads are supported.");
}

export function normalizeExtractedRecords(
  extracted: ExtractedResult,
  sourceId: string,
  syncRunId: string,
  originalFilename: string
): NormalizedResult {
  const records: NormalizedRecord[] = extracted.records.map((record) => {
    const payload = {
      ...record.basePayload,
      _meta: {
        source_id: sourceId,
        sync_run_id: syncRunId,
        locator: record.locator,
        filename: originalFilename,
        ...record.extractionMeta
      }
    };

    return {
      payload,
      rawRecordLocator: record.locator,
      contentHash: hashSha256(stableSerialize(record.hashMaterial))
    };
  });

  return {
    rawMimeType: extracted.rawMimeType,
    records
  };
}

export function buildUploadObjectKey(
  sourceId: string,
  uploadId: string,
  originalFilename: string,
  uploadedAt: Date = new Date()
): string {
  const yyyy = String(uploadedAt.getUTCFullYear());
  const mm = String(uploadedAt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(uploadedAt.getUTCDate()).padStart(2, "0");
  const safeFilename = basename(originalFilename || "upload.bin").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `uploads/${sourceId}/${yyyy}/${mm}/${dd}/${uploadId}/${safeFilename || "upload.bin"}`;
}
