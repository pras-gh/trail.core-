import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, basename } from "node:path";
import { parse as parseCsv } from "csv-parse/sync";

export const UPLOAD_PARSE_QUEUE = "upload-parse";

export interface UploadParseJobData {
  sourceId: string;
  sourceSystem: string;
  syncRunId: string;
  uploadId: string;
  externalId: string | null;
  originalFilename: string;
  objectKey: string;
  mimeType: string;
}

export interface ExtractedRecord {
  rawJson: Record<string, unknown>;
  rowIndex: number;
}

export interface ExtractedResult {
  rawMimeType: string;
  records: ExtractedRecord[];
}

export interface NormalizedRecord {
  rawJson: Record<string, unknown>;
  rowIndex: number;
  rowSha256: string;
}

export interface NormalizedResult {
  rawMimeType: string;
  records: NormalizedRecord[];
}

export interface NormalizedTransactionCandidate {
  rowSha256: string;
  occurredAt: string | null;
  amount: string;
  currency: string;
  description: string;
  merchant: string | null;
  accountId: string | null;
  category: string | null;
  normalizationVersion: string;
}

export interface NormalizeBankCsvInput {
  filePath?: string;
  fileBytes?: Buffer | Uint8Array;
  source: string;
  normalizationVersion?: string;
}

export interface NormalizedBankCsvTransaction extends NormalizedTransactionCandidate {
  source: string;
}

function hashSha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

const DECIMAL_SCALE = 6;

const LOWERCASE_TEXT_FIELD_KEYS = new Set([
  "description",
  "merchant",
  "memo",
  "narration",
  "payee",
  "details"
]);

const NORMALIZED_AMOUNT_KEYS = ["amount", "amt", "debit", "credit", "value", "total", "transaction_amount"];
const NORMALIZED_CURRENCY_KEYS = ["currency", "currency_code", "ccy", "curr"];
const NORMALIZED_DESCRIPTION_KEYS = ["description", "memo", "narration", "details", "note", "remarks"];
const NORMALIZED_MERCHANT_KEYS = ["merchant", "payee", "merchant_name"];
const NORMALIZED_ACCOUNT_KEYS = ["account_id", "account", "account_number", "iban"];
const NORMALIZED_CATEGORY_KEYS = ["category", "type", "txn_type"];
const NORMALIZED_OCCURRED_AT_KEYS = [
  "occurred_at",
  "transaction_date",
  "posted_at",
  "posted_date",
  "date",
  "value_date",
  "timestamp",
  "datetime"
];

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

function normalizeRuleKey(rawKey: string | null | undefined): string {
  if (!rawKey) {
    return "";
  }

  return rawKey
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function isDateFieldKey(rawKey: string | null | undefined): boolean {
  const key = normalizeRuleKey(rawKey);
  return /(^|_)(date|time|timestamp|datetime|posted_at|occurred_at|transaction_date|value_date)$/.test(
    key
  );
}

function isNumericFieldKey(rawKey: string | null | undefined): boolean {
  const key = normalizeRuleKey(rawKey);
  return /(^|_)(amount|amt|debit|credit|balance|fee|total|value)$/.test(key);
}

function isLowercaseTextFieldKey(rawKey: string | null | undefined): boolean {
  return LOWERCASE_TEXT_FIELD_KEYS.has(normalizeRuleKey(rawKey));
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return candidate.toISOString().slice(0, 10);
}

function normalizeTwoDigitYear(twoDigitYear: number): number {
  return twoDigitYear >= 70 ? 1900 + twoDigitYear : 2000 + twoDigitYear;
}

function normalizeDateString(value: string): string | null {
  const trimmed = value.normalize("NFKC").trim();
  if (!trimmed) {
    return null;
  }

  const isoDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoDateMatch) {
    return toIsoDate(Number(isoDateMatch[1]), Number(isoDateMatch[2]), Number(isoDateMatch[3]));
  }

  const slashDateMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(trimmed);
  if (slashDateMatch) {
    const month = Number(slashDateMatch[1]);
    const day = Number(slashDateMatch[2]);
    const yearToken = slashDateMatch[3] ?? "";
    if (!yearToken) {
      return null;
    }

    const rawYear = Number(yearToken);
    const year = yearToken.length === 2 ? normalizeTwoDigitYear(rawYear) : rawYear;
    return toIsoDate(year, month, day);
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function normalizeDecimalString(value: string): string | null {
  let trimmed = value.normalize("NFKC").trim();
  if (!trimmed) {
    return null;
  }

  let isNegative = false;
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    isNegative = true;
    trimmed = trimmed.slice(1, -1);
  }

  trimmed = trimmed.replace(/[$€£₹,]/g, "").replace(/\s+/g, "");
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("+")) {
    trimmed = trimmed.slice(1);
  } else if (trimmed.startsWith("-")) {
    isNegative = true;
    trimmed = trimmed.slice(1);
  }

  const match = /^(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) {
    return null;
  }

  const integerToken = match[1] ?? "";
  const fractionToken = match[2] ?? "";
  if (integerToken.length === 0 && fractionToken.length === 0) {
    return null;
  }

  const normalizedInteger = integerToken.length > 0 ? integerToken.replace(/^0+(?=\d)/, "") : "0";
  const normalizedFraction = fractionToken.slice(0, DECIMAL_SCALE).padEnd(DECIMAL_SCALE, "0");
  const roundingDigit = fractionToken.length > DECIMAL_SCALE ? Number(fractionToken[DECIMAL_SCALE]) : 0;

  const scale = 10n ** BigInt(DECIMAL_SCALE);
  let scaled =
    BigInt(normalizedInteger || "0") * scale + BigInt(normalizedFraction.length ? normalizedFraction : "0");

  if (roundingDigit >= 5) {
    scaled += 1n;
  }

  if (isNegative && scaled !== 0n) {
    scaled = -scaled;
  }

  const absolute = scaled < 0n ? -scaled : scaled;
  const whole = (absolute / scale).toString();
  const decimal = (absolute % scale).toString().padStart(DECIMAL_SCALE, "0");
  const sign = scaled < 0n ? "-" : "";
  return `${sign}${whole}.${decimal}`;
}

function normalizeScalarValue(value: string | number | boolean, fieldKey: string | null | undefined): unknown {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return String(value);
    }

    if (isNumericFieldKey(fieldKey)) {
      return normalizeDecimalString(String(value)) ?? String(value);
    }

    return value;
  }

  const normalizedString = value.normalize("NFKC").trim();
  if (isDateFieldKey(fieldKey)) {
    const normalizedDate = normalizeDateString(normalizedString);
    if (normalizedDate !== null) {
      return normalizedDate;
    }
  }

  if (isNumericFieldKey(fieldKey)) {
    const normalizedDecimal = normalizeDecimalString(normalizedString);
    if (normalizedDecimal !== null) {
      return normalizedDecimal;
    }
  }

  if (isLowercaseTextFieldKey(fieldKey)) {
    return normalizedString.toLowerCase().replace(/\s+/g, " ");
  }

  return normalizedString;
}

function canonicalizeRowValue(value: unknown, fieldKey?: string): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeRowValue(item));
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const canonical: Record<string, unknown> = {};

    for (const key of Object.keys(objectValue).sort()) {
      canonical[key] = canonicalizeRowValue(objectValue[key], key);
    }

    return canonical;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return normalizeScalarValue(value, fieldKey);
  }

  return String(value);
}

function normalizeFlatString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return null;
}

function buildFieldLookup(rawJson: Record<string, unknown>): Map<string, unknown> {
  const lookup = new Map<string, unknown>();
  for (const [key, value] of Object.entries(rawJson)) {
    lookup.set(normalizeRuleKey(key), value);
  }
  return lookup;
}

function pickFirstNormalizedValue(
  lookup: Map<string, unknown>,
  candidateKeys: readonly string[]
): string | null {
  for (const candidateKey of candidateKeys) {
    const normalized = normalizeFlatString(lookup.get(candidateKey));
    if (normalized !== null) {
      return normalized;
    }
  }
  return null;
}

function normalizeCurrencyCode(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const cleaned = value
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z$€£₹]/g, "");

  if (cleaned.length === 3) {
    return cleaned;
  }

  if (cleaned === "$") {
    return "USD";
  }

  if (cleaned === "€") {
    return "EUR";
  }

  if (cleaned === "£") {
    return "GBP";
  }

  if (cleaned === "₹") {
    return "INR";
  }

  return null;
}

async function resolveNormalizeBankCsvBytes(input: NormalizeBankCsvInput): Promise<Buffer> {
  const hasPath = typeof input.filePath === "string" && input.filePath.trim().length > 0;
  const hasBytes = input.fileBytes instanceof Uint8Array;

  if ((hasPath && hasBytes) || (!hasPath && !hasBytes)) {
    throw new Error("Provide exactly one of filePath or fileBytes.");
  }

  if (hasPath) {
    return readFile(input.filePath as string);
  }

  const bytes = input.fileBytes as Uint8Array;
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}

export function deriveNormalizedTransactionsFromRows(
  rows: NormalizedRecord[],
  options?: {
    normalizationVersion?: string;
    defaultCurrency?: string;
  }
): NormalizedTransactionCandidate[] {
  const normalizationVersion = (options?.normalizationVersion ?? "v1").trim() || "v1";
  const defaultCurrency = normalizeCurrencyCode(options?.defaultCurrency ?? null);

  return rows.flatMap((row) => {
    const lookup = buildFieldLookup(row.rawJson);

    const amountRaw = pickFirstNormalizedValue(lookup, NORMALIZED_AMOUNT_KEYS);
    const amount = amountRaw ? normalizeDecimalString(amountRaw) : null;
    if (!amount) {
      return [];
    }

    const currencyRaw = pickFirstNormalizedValue(lookup, NORMALIZED_CURRENCY_KEYS);
    const currency = normalizeCurrencyCode(currencyRaw) ?? defaultCurrency;
    if (!currency) {
      return [];
    }

    const description = pickFirstNormalizedValue(lookup, NORMALIZED_DESCRIPTION_KEYS);
    if (!description) {
      return [];
    }

    const merchant = pickFirstNormalizedValue(lookup, NORMALIZED_MERCHANT_KEYS);
    const accountId = pickFirstNormalizedValue(lookup, NORMALIZED_ACCOUNT_KEYS);
    const category = pickFirstNormalizedValue(lookup, NORMALIZED_CATEGORY_KEYS);

    const occurredAtRaw = pickFirstNormalizedValue(lookup, NORMALIZED_OCCURRED_AT_KEYS);
    const occurredAt = occurredAtRaw ? normalizeDateString(occurredAtRaw) : null;

    return [
      {
        rowSha256: row.rowSha256,
        occurredAt,
        amount,
        currency,
        description,
        merchant,
        accountId,
        category,
        normalizationVersion
      }
    ];
  });
}

export async function normalizeBankCsv(
  input: NormalizeBankCsvInput
): Promise<NormalizedBankCsvTransaction[]> {
  const source = input.source.normalize("NFKC").trim();
  if (!source) {
    throw new Error("source is required.");
  }

  const fileBuffer = await resolveNormalizeBankCsvBytes(input);
  const filename = input.filePath ? basename(input.filePath) : `${source}.csv`;
  const extracted = extractUpload(fileBuffer, "text/csv", filename);
  const normalized = normalizeExtractedRecords(extracted);
  const normalizationVersion = input.normalizationVersion ?? "v1";

  const rows = deriveNormalizedTransactionsFromRows(normalized.records, {
    normalizationVersion,
    defaultCurrency: "INR"
  });

  return rows.map((row) => ({
    ...row,
    source
  }));
}

export const normalize_bank_csv = normalizeBankCsv;

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

  const records = rows.slice(1).map((values, index) => {
    const rowPayload: Record<string, unknown> = {};

    headers.forEach((headerName, headerIndex) => {
      rowPayload[headerName] = values[headerIndex] ?? null;
    });

    return {
      rawJson: rowPayload,
      rowIndex: index
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

  return {
    rawMimeType: "application/pdf",
    records: [
      {
        rawJson: {
          text: extractedText
        },
        rowIndex: 0
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

export function normalizeExtractedRecords(extracted: ExtractedResult): NormalizedResult {
  const records: NormalizedRecord[] = extracted.records.map((record) => {
    const canonicalRow = canonicalizeRowValue(record.rawJson) as Record<string, unknown>;

    return {
      rawJson: record.rawJson,
      rowIndex: record.rowIndex,
      rowSha256: hashSha256(stableSerialize(canonicalRow))
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
