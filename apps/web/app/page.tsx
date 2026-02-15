"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

interface NormalizedTransactionItem {
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

interface UploadResult {
  upload_id: string;
  sync_run_id: string;
  status: "queued" | "succeeded";
  counts: {
    total: number;
    inserted: number;
    duplicates: number;
  };
  normalized_transactions: NormalizedTransactionItem[];
}

interface AdminMetrics {
  totalSources: number;
  activeSources: number;
  syncRunsLast24h: number;
  uploadsLast24h: number;
  rawRowsLast24h: number;
  normalizedTransactionsLast24h: number;
}

interface AdminSyncRunSummary {
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

interface AdminUploadSummary {
  id: string;
  sourceId: string;
  sourceName: string;
  syncRunId: string;
  syncRunStatus: string;
  filename: string;
  rawMimeType: string;
  uploadedAt: string;
  rowCount: number;
}

interface AdminOverview {
  generatedAt: string;
  metrics: AdminMetrics;
  recentSyncRuns: AdminSyncRunSummary[];
  recentUploads: AdminUploadSummary[];
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 10)}...` : value;
}

function statusStyles(status: string): { color: string; background: string } {
  const normalized = status.toLowerCase();

  if (normalized === "succeeded") {
    return { color: "var(--ok)", background: "var(--ok-bg)" };
  }

  if (normalized === "failed") {
    return { color: "var(--bad)", background: "var(--bad-bg)" };
  }

  if (normalized === "running" || normalized === "queued" || normalized === "partial") {
    return { color: "var(--warn)", background: "var(--warn-bg)" };
  }

  return { color: "var(--text-muted)", background: "var(--surface-muted)" };
}

const PANEL_STYLE: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 14,
  padding: 18,
  boxShadow: "0 4px 22px rgba(17, 35, 31, 0.04)"
};

export default function HomePage(): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [externalId, setExternalId] = useState("");
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);

  const apiBase = useMemo(() => process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000", []);

  const loadOverview = useCallback(async (): Promise<void> => {
    try {
      setOverviewError(null);
      const response = await fetch(`${apiBase}/admin/overview?limit=12`, {
        method: "GET",
        cache: "no-store"
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? `Overview request failed (${response.status})`);
      }

      const responseBody = (await response.json()) as AdminOverview;
      setOverview(responseBody);
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : "Failed to load overview");
    } finally {
      setOverviewLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void loadOverview();
    const intervalId = window.setInterval(() => {
      void loadOverview();
    }, 15000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadOverview]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setUploadError(null);
    setUploadResult(null);

    if (!file) {
      setUploadError("Select a CSV or PDF file first.");
      return;
    }

    setUploadLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      if (sourceId.trim().length > 0) {
        formData.append("source_id", sourceId.trim());
      }

      if (externalId.trim().length > 0) {
        formData.append("external_id", externalId.trim());
      }

      const response = await fetch(`${apiBase}/upload`, {
        method: "POST",
        body: formData
      });

      const responseBody = (await response.json()) as UploadResult & { error?: string };

      if (!response.ok) {
        setUploadError(responseBody.error ?? "Upload failed");
        return;
      }

      setUploadResult(responseBody);
      void loadOverview();
    } catch (submitError) {
      setUploadError(submitError instanceof Error ? submitError.message : "Upload failed");
    } finally {
      setUploadLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "30px 18px 36px" }}>
      <section
        style={{
          ...PANEL_STYLE,
          padding: 22,
          marginBottom: 16,
          background: "linear-gradient(128deg, #ffffff 20%, #eef8f5 100%)"
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 31, letterSpacing: "-0.02em" }}>tail.core Admin Console</h1>
            <p style={{ margin: "8px 0 0", color: "var(--text-muted)" }}>
              Minimal operations surface for uploads, ingestion status, and normalization output.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadOverview()}
            style={{
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "10px 14px",
              background: "var(--surface)",
              color: "var(--text-strong)",
              cursor: "pointer",
              fontWeight: 600
            }}
          >
            Refresh
          </button>
          <a
            href="/normalized"
            style={{
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "10px 14px",
              background: "var(--surface)",
              color: "var(--text-strong)",
              textDecoration: "none",
              fontWeight: 600
            }}
          >
            Normalized List
          </a>
        </div>
        <p style={{ margin: "12px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
          Updated: {overview?.generatedAt ? formatDateTime(overview.generatedAt) : "-"}
        </p>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 12,
          marginBottom: 16
        }}
      >
        {[
          { label: "Sources", value: overview?.metrics.totalSources ?? 0 },
          { label: "Active Sources", value: overview?.metrics.activeSources ?? 0 },
          { label: "Sync Runs (24h)", value: overview?.metrics.syncRunsLast24h ?? 0 },
          { label: "Uploads (24h)", value: overview?.metrics.uploadsLast24h ?? 0 },
          { label: "Raw Rows (24h)", value: overview?.metrics.rawRowsLast24h ?? 0 },
          {
            label: "Normalized Tx (24h)",
            value: overview?.metrics.normalizedTransactionsLast24h ?? 0
          }
        ].map((metric) => (
          <article key={metric.label} style={{ ...PANEL_STYLE, padding: 14 }}>
            <p style={{ margin: "0 0 6px", color: "var(--text-muted)", fontSize: 13 }}>{metric.label}</p>
            <p style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>{metric.value}</p>
          </article>
        ))}
      </section>

      <section style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(320px, 420px) minmax(0, 1fr)" }}>
        <article style={PANEL_STYLE}>
          <h2 style={{ margin: "0 0 12px" }}>Upload</h2>
          <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
              File (CSV or PDF)
              <input
                type="file"
                accept=".csv,.pdf,text/csv,application/pdf"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                style={{ border: "1px solid var(--line)", padding: 9, borderRadius: 8, background: "#fff" }}
              />
            </label>

            <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
              source_id (optional)
              <input
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
                style={{ border: "1px solid var(--line)", padding: 9, borderRadius: 8 }}
              />
            </label>

            <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
              external_id (optional)
              <input
                value={externalId}
                onChange={(event) => setExternalId(event.target.value)}
                style={{ border: "1px solid var(--line)", padding: 9, borderRadius: 8 }}
              />
            </label>

            <button
              type="submit"
              disabled={uploadLoading}
              style={{
                border: "none",
                borderRadius: 10,
                padding: "11px 14px",
                background: "var(--accent)",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              {uploadLoading ? "Uploading..." : "Upload"}
            </button>
          </form>

          {uploadError ? (
            <pre style={{ marginTop: 12, padding: 10, background: "var(--bad-bg)", borderRadius: 8 }}>{uploadError}</pre>
          ) : null}

          {uploadResult ? (
            <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
              <div style={{ background: "var(--accent-soft)", padding: 10, borderRadius: 8 }}>
                <strong>Status:</strong> {uploadResult.status}
                <br />
                <strong>upload_id:</strong> <code>{uploadResult.upload_id}</code>
                {" "}<a href={`/uploads/${uploadResult.upload_id}`}>Open</a>
                <br />
                <strong>sync_run_id:</strong> <code>{uploadResult.sync_run_id}</code>
                <br />
                <strong>Counts:</strong> {uploadResult.counts.total} total / {uploadResult.counts.inserted} inserted / {" "}
                {uploadResult.counts.duplicates} duplicates
              </div>
            </div>
          ) : null}
        </article>

        <div style={{ display: "grid", gap: 16 }}>
          <article style={PANEL_STYLE}>
            <h2 style={{ margin: "0 0 10px" }}>Recent Sync Runs</h2>
            {overviewLoading ? <p style={{ color: "var(--text-muted)" }}>Loading...</p> : null}
            {overviewError ? <p style={{ color: "var(--bad)" }}>{overviewError}</p> : null}

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                    <th style={{ padding: "7px 6px" }}>Run</th>
                    <th style={{ padding: "7px 6px" }}>Source</th>
                    <th style={{ padding: "7px 6px" }}>Status</th>
                    <th style={{ padding: "7px 6px" }}>Records</th>
                    <th style={{ padding: "7px 6px" }}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {overview?.recentSyncRuns.map((run) => {
                    const tones = statusStyles(run.status);
                    return (
                      <tr key={run.id} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "7px 6px" }}>
                          <code>{shortId(run.id)}</code>
                        </td>
                        <td style={{ padding: "7px 6px" }}>
                          <div>{run.sourceName}</div>
                          <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{run.sourceKind}</div>
                        </td>
                        <td style={{ padding: "7px 6px" }}>
                          <span
                            style={{
                              padding: "3px 8px",
                              borderRadius: 999,
                              color: tones.color,
                              background: tones.background,
                              fontWeight: 600,
                              textTransform: "capitalize"
                            }}
                          >
                            {run.status}
                          </span>
                        </td>
                        <td style={{ padding: "7px 6px" }}>
                          {run.insertedRecords ?? 0}/{run.totalRecords ?? 0}
                        </td>
                        <td style={{ padding: "7px 6px", color: "var(--text-muted)" }}>{formatDateTime(run.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>

          <article style={PANEL_STYLE}>
            <h2 style={{ margin: "0 0 10px" }}>Recent Uploads</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                    <th style={{ padding: "7px 6px" }}>Upload</th>
                    <th style={{ padding: "7px 6px" }}>File</th>
                    <th style={{ padding: "7px 6px" }}>Source</th>
                    <th style={{ padding: "7px 6px" }}>Rows</th>
                    <th style={{ padding: "7px 6px" }}>When</th>
                  </tr>
                </thead>
                <tbody>
                  {overview?.recentUploads.map((upload) => {
                    const tones = statusStyles(upload.syncRunStatus);
                    return (
                      <tr key={upload.id} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "7px 6px" }}>
                          <a href={`/uploads/${upload.id}`}>
                            <code>{shortId(upload.id)}</code>
                          </a>
                        </td>
                        <td style={{ padding: "7px 6px" }}>
                          <div>{upload.filename}</div>
                          <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{upload.rawMimeType}</div>
                        </td>
                        <td style={{ padding: "7px 6px" }}>
                          <div>{upload.sourceName}</div>
                          <span
                            style={{
                              marginTop: 3,
                              display: "inline-block",
                              padding: "2px 7px",
                              borderRadius: 999,
                              color: tones.color,
                              background: tones.background,
                              fontWeight: 600,
                              textTransform: "capitalize"
                            }}
                          >
                            {upload.syncRunStatus}
                          </span>
                        </td>
                        <td style={{ padding: "7px 6px" }}>{upload.rowCount}</td>
                        <td style={{ padding: "7px 6px", color: "var(--text-muted)" }}>
                          {formatDateTime(upload.uploadedAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>

          <article style={PANEL_STYLE}>
            <h2 style={{ margin: "0 0 10px" }}>Last Normalized Output</h2>
            {!uploadResult ? <p style={{ color: "var(--text-muted)" }}>Upload a file to preview normalized rows.</p> : null}
            {uploadResult && uploadResult.normalized_transactions.length === 0 ? (
              <p style={{ color: "var(--text-muted)" }}>No normalized rows returned for this upload.</p>
            ) : null}
            {uploadResult && uploadResult.normalized_transactions.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                      <th style={{ padding: "7px 6px" }}>Date</th>
                      <th style={{ padding: "7px 6px" }}>Amount</th>
                      <th style={{ padding: "7px 6px" }}>Description</th>
                      <th style={{ padding: "7px 6px" }}>Merchant</th>
                      <th style={{ padding: "7px 6px" }}>Category</th>
                      <th style={{ padding: "7px 6px" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploadResult.normalized_transactions.slice(0, 12).map((item) => (
                      <tr key={item.row_sha256} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "7px 6px" }}>{formatDateTime(item.occurred_at)}</td>
                        <td style={{ padding: "7px 6px", fontWeight: 600 }}>
                          {item.currency} {item.amount}
                        </td>
                        <td style={{ padding: "7px 6px" }}>{item.description}</td>
                        <td style={{ padding: "7px 6px" }}>{item.merchant ?? "-"}</td>
                        <td style={{ padding: "7px 6px" }}>{item.category ?? "-"}</td>
                        <td style={{ padding: "7px 6px" }}>
                          <a href={`/rows/${item.row_sha256}?upload_id=${uploadResult.upload_id}`}>View</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </article>
        </div>
      </section>
    </main>
  );
}
