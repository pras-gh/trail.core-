"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type RawStatusChip = "RAW_INSERTED" | "RAW_DUPLICATE" | "RAW_PENDING";
type NormalizedStatusChip = "NORMALIZED_EXISTS" | "NORMALIZED_MISSING";

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

function chipStyle(status: string): React.CSSProperties {
  const normalized = status.toLowerCase();

  if (normalized.includes("inserted") || normalized.includes("exists")) {
    return { background: "var(--ok-bg)", color: "var(--ok)" };
  }

  if (normalized.includes("duplicate")) {
    return { background: "var(--warn-bg)", color: "var(--warn)" };
  }

  return { background: "var(--surface-muted)", color: "var(--text-muted)" };
}

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

export default function RawRowDetailPage(): JSX.Element {
  const params = useParams<{ rowSha256: string }>();
  const searchParams = useSearchParams();

  const rowSha256 = typeof params.rowSha256 === "string" ? params.rowSha256 : "";
  const uploadId = searchParams.get("upload_id");

  const [data, setData] = useState<RowDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const apiBase = useMemo(() => process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000", []);

  useEffect(() => {
    if (!rowSha256) {
      return;
    }

    let mounted = true;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);

        const query = uploadId ? `?upload_id=${encodeURIComponent(uploadId)}` : "";
        const response = await fetch(`${apiBase}/admin/rows/${encodeURIComponent(rowSha256)}${query}`, {
          cache: "no-store"
        });

        const body = (await response.json().catch(() => ({}))) as RowDetailResponse & { message?: string };

        if (!response.ok) {
          throw new Error(body.message ?? `Request failed (${response.status})`);
        }

        if (mounted) {
          setData(body);
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load row detail.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      mounted = false;
    };
  }, [apiBase, rowSha256, uploadId]);

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "30px 18px 36px", display: "grid", gap: 16 }}>
      <section
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: 18,
          boxShadow: "0 4px 22px rgba(17, 35, 31, 0.04)"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h1 style={{ margin: 0 }}>Raw Row Detail</h1>
            <p style={{ margin: "8px 0 0", color: "var(--text-muted)" }}>
              <code>{rowSha256}</code>
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a href={uploadId ? `/uploads/${uploadId}` : "/"}>Back</a>
            <a href="/normalized">Normalized List</a>
          </div>
        </div>
      </section>

      {loading ? <p>Loading...</p> : null}
      {error ? <pre style={{ background: "var(--bad-bg)", padding: 12, borderRadius: 8 }}>{error}</pre> : null}

      {data ? (
        <>
          <section
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 14,
              padding: 14,
              display: "grid",
              gap: 8
            }}
          >
            <p style={{ margin: 0 }}>
              Upload: <a href={`/uploads/${data.row.upload_id}`}>{data.row.upload_filename}</a> | Source:{" "}
              {data.row.source_name} ({data.row.source_system}) | Row index: {data.row.row_index}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={{ ...chipStyle(data.status.raw), padding: "3px 10px", borderRadius: 999, fontWeight: 600 }}>
                {data.status.raw}
              </span>
              <span
                style={{ ...chipStyle(data.status.normalized), padding: "3px 10px", borderRadius: 999, fontWeight: 600 }}
              >
                {data.status.normalized}
              </span>
            </div>
          </section>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: 16
            }}
          >
            <article
              style={{
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: 14,
                padding: 14
              }}
            >
              <h2 style={{ marginTop: 0 }}>Raw JSON</h2>
              <pre
                style={{
                  background: "var(--surface-muted)",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  padding: 12,
                  overflowX: "auto"
                }}
              >
                {JSON.stringify(data.row.raw_json, null, 2)}
              </pre>
            </article>

            <article
              style={{
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: 14,
                padding: 14
              }}
            >
              <h2 style={{ marginTop: 0 }}>Normalized Transaction</h2>
              {!data.normalized_transaction ? (
                <p style={{ color: "var(--text-muted)" }}>NORMALIZED_MISSING</p>
              ) : (
                <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
                  <p style={{ margin: 0 }}>
                    <strong>Date:</strong> {formatDate(data.normalized_transaction.occurred_at)}
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Amount:</strong> {data.normalized_transaction.currency} {data.normalized_transaction.amount}
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Description:</strong> {data.normalized_transaction.description}
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Merchant:</strong> {data.normalized_transaction.merchant ?? "-"}
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Category:</strong> {data.normalized_transaction.category ?? "-"}
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Account ID:</strong> {data.normalized_transaction.account_id ?? "-"}
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Version:</strong> {data.normalized_transaction.normalization_version}
                  </p>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>
                    Created: {formatDate(data.normalized_transaction.created_at)}
                  </p>
                </div>
              )}
            </article>
          </section>
        </>
      ) : null}
    </main>
  );
}
