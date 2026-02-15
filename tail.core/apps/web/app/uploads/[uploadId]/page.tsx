"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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

export default function UploadDetailPage(): JSX.Element {
  const params = useParams<{ uploadId: string }>();
  const uploadId = typeof params.uploadId === "string" ? params.uploadId : "";

  const [data, setData] = useState<UploadDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const apiBase = useMemo(() => process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000", []);

  useEffect(() => {
    if (!uploadId) {
      return;
    }

    let mounted = true;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(`${apiBase}/admin/uploads/${encodeURIComponent(uploadId)}`, {
          cache: "no-store"
        });

        const body = (await response.json().catch(() => ({}))) as UploadDetailResponse & { message?: string };

        if (!response.ok) {
          throw new Error(body.message ?? `Request failed (${response.status})`);
        }

        if (mounted) {
          setData(body);
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load upload detail.");
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
  }, [apiBase, uploadId]);

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
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1 style={{ margin: 0 }}>Upload Detail</h1>
            <p style={{ margin: "8px 0 0", color: "var(--text-muted)" }}>
              Metadata and raw row view for upload <code>{uploadId}</code>
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a href="/">Back to Dashboard</a>
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
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12
            }}
          >
            <article style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>Filename</p>
              <p style={{ margin: "6px 0 0", fontWeight: 700 }}>{data.upload.filename}</p>
            </article>
            <article style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>Uploaded At</p>
              <p style={{ margin: "6px 0 0", fontWeight: 700 }}>{formatDate(data.upload.uploaded_at)}</p>
            </article>
            <article style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>Source</p>
              <p style={{ margin: "6px 0 0", fontWeight: 700 }}>{data.upload.source_name}</p>
              <p style={{ margin: "2px 0 0", color: "var(--text-muted)", fontSize: 12 }}>{data.upload.source_kind}</p>
              <p style={{ margin: "2px 0 0", color: "var(--text-muted)", fontSize: 12 }}>
                {data.upload.source_system}
              </p>
            </article>
            <article style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>Content SHA256</p>
              <code style={{ fontSize: 12 }}>{data.upload.content_sha256}</code>
            </article>
          </section>

          <section
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 14,
              padding: 14
            }}
          >
            <p style={{ margin: 0 }}>
              Attempted: <strong>{data.summary.attempted_rows}</strong> | Inserted: <strong>{data.summary.inserted_rows}</strong>
              {" "}| Duplicates: <strong>{data.summary.duplicate_rows}</strong> | Pending: <strong>{data.summary.pending_rows}</strong>
            </p>
            <p style={{ margin: "6px 0 0" }}>
              Normalized Exists: <strong>{data.summary.normalized_exists}</strong> | Missing:{" "}
              <strong>{data.summary.normalized_missing}</strong>
            </p>
          </section>

          <section
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 14,
              padding: 14,
              overflowX: "auto"
            }}
          >
            <h2 style={{ marginTop: 0 }}>Raw Rows</h2>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)", textAlign: "left" }}>
                  <th style={{ padding: "7px 6px" }}>row_index</th>
                  <th style={{ padding: "7px 6px" }}>date</th>
                  <th style={{ padding: "7px 6px" }}>amount</th>
                  <th style={{ padding: "7px 6px" }}>description</th>
                  <th style={{ padding: "7px 6px" }}>row_sha256</th>
                  <th style={{ padding: "7px 6px" }}>raw</th>
                  <th style={{ padding: "7px 6px" }}>normalized</th>
                  <th style={{ padding: "7px 6px" }}>action</th>
                </tr>
              </thead>
              <tbody>
                {data.raw_rows.map((row) => (
                  <tr key={`${row.row_index}:${row.row_sha256}`} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "7px 6px" }}>{row.row_index}</td>
                    <td style={{ padding: "7px 6px" }}>{formatDate(row.date)}</td>
                    <td style={{ padding: "7px 6px" }}>{row.amount ?? "-"}</td>
                    <td style={{ padding: "7px 6px" }}>{row.description ?? "-"}</td>
                    <td style={{ padding: "7px 6px" }}>
                      <code>{row.row_sha256.slice(0, 12)}...</code>
                    </td>
                    <td style={{ padding: "7px 6px" }}>
                      <span style={{ ...chipStyle(row.raw_status), padding: "2px 8px", borderRadius: 999, fontWeight: 600 }}>
                        {row.raw_status}
                      </span>
                    </td>
                    <td style={{ padding: "7px 6px" }}>
                      <span
                        style={{ ...chipStyle(row.normalized_status), padding: "2px 8px", borderRadius: 999, fontWeight: 600 }}
                      >
                        {row.normalized_status}
                      </span>
                    </td>
                    <td style={{ padding: "7px 6px" }}>
                      <a href={`/rows/${row.row_sha256}?upload_id=${data.upload.id}`}>View normalized</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </main>
  );
}
