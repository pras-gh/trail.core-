"use client";

import { FormEvent, useMemo, useState } from "react";

interface UploadResult {
  upload_id: string;
  sync_run_id: string;
  status: string;
  counts: {
    total: number;
    inserted: number;
    duplicates: number;
  };
}

export default function HomePage(): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [externalId, setExternalId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiBase = useMemo(() => process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000", []);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!file) {
      setError("Select a CSV or PDF file first.");
      return;
    }

    setLoading(true);

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

      const responseBody = await response.json();

      if (!response.ok) {
        setError(responseBody.error ?? "Upload failed");
        return;
      }

      setResult(responseBody as UploadResult);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", background: "white", padding: 24, borderRadius: 12 }}>
      <h1 style={{ marginTop: 0 }}>tail.core Admin Upload</h1>
      <p style={{ color: "#4b5563" }}>
        Upload CSV or PDF, store raw blob bytes, and write canonical rows into <code>raw_events</code>.
      </p>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <label>
          File (CSV or PDF)
          <input
            type="file"
            accept=".csv,.pdf,text/csv,application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <label>
          source_id (optional)
          <input value={sourceId} onChange={(event) => setSourceId(event.target.value)} />
        </label>

        <label>
          external_id (optional)
          <input value={externalId} onChange={(event) => setExternalId(event.target.value)} />
        </label>

        <button type="submit" disabled={loading}>
          {loading ? "Uploading..." : "Upload"}
        </button>
      </form>

      {error ? (
        <pre style={{ marginTop: 16, padding: 12, background: "#fee2e2", borderRadius: 8 }}>{error}</pre>
      ) : null}

      {result ? (
        <pre style={{ marginTop: 16, padding: 12, background: "#ecfeff", borderRadius: 8 }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </main>
  );
}
