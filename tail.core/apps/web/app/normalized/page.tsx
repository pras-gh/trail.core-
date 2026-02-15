"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

interface NormalizedTransactionListItem {
  id: string;
  row_sha256: string;
  occurred_at: string | null;
  amount: string;
  currency: string;
  description: string;
  merchant: string | null;
  account_id: string | null;
  category: string | null;
  normalization_version: string;
  source_name: string;
  upload_id: string;
  created_at: string;
}

interface NormalizedListResponse {
  total: number;
  items: NormalizedTransactionListItem[];
}

interface FiltersState {
  from: string;
  to: string;
  minAmount: string;
  maxAmount: string;
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

function buildQuery(filters: FiltersState): string {
  const params = new URLSearchParams();
  params.set("limit", "100");

  if (filters.from.trim()) {
    params.set("from", filters.from.trim());
  }

  if (filters.to.trim()) {
    params.set("to", filters.to.trim());
  }

  if (filters.minAmount.trim()) {
    params.set("min_amount", filters.minAmount.trim());
  }

  if (filters.maxAmount.trim()) {
    params.set("max_amount", filters.maxAmount.trim());
  }

  return params.toString();
}

export default function NormalizedTransactionsPage(): JSX.Element {
  const [filters, setFilters] = useState<FiltersState>({
    from: "",
    to: "",
    minAmount: "",
    maxAmount: ""
  });
  const [data, setData] = useState<NormalizedListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const apiBase = useMemo(() => process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000", []);

  async function load(nextFilters: FiltersState): Promise<void> {
    try {
      setLoading(true);
      setError(null);

      const query = buildQuery(nextFilters);
      const response = await fetch(`${apiBase}/admin/normalized-transactions?${query}`, {
        cache: "no-store"
      });

      const body = (await response.json().catch(() => ({}))) as NormalizedListResponse & { message?: string };
      if (!response.ok) {
        throw new Error(body.message ?? `Request failed (${response.status})`);
      }

      setData(body);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load normalized transactions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(filters);
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await load(filters);
  }

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
            <h1 style={{ margin: 0 }}>Normalized Transactions</h1>
            <p style={{ margin: "8px 0 0", color: "var(--text-muted)" }}>Quick filter by date range and amount.</p>
          </div>
          <a href="/">Back to Dashboard</a>
        </div>
      </section>

      <section
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: 14
        }}
      >
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
          <label style={{ display: "grid", gap: 4 }}>
            From (ISO)
            <input
              value={filters.from}
              onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
              placeholder="2026-02-01"
              style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 9 }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            To (ISO)
            <input
              value={filters.to}
              onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
              placeholder="2026-02-15"
              style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 9 }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            Min amount
            <input
              value={filters.minAmount}
              onChange={(event) => setFilters((current) => ({ ...current, minAmount: event.target.value }))}
              placeholder="-5000"
              style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 9 }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            Max amount
            <input
              value={filters.maxAmount}
              onChange={(event) => setFilters((current) => ({ ...current, maxAmount: event.target.value }))}
              placeholder="10000"
              style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 9 }}
            />
          </label>
          <button
            type="submit"
            style={{
              border: "none",
              borderRadius: 10,
              padding: "11px 14px",
              background: "var(--accent)",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
              marginTop: 22
            }}
          >
            Apply Filters
          </button>
        </form>
      </section>

      {loading ? <p>Loading...</p> : null}
      {error ? <pre style={{ background: "var(--bad-bg)", padding: 12, borderRadius: 8 }}>{error}</pre> : null}

      <section
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: 14,
          overflowX: "auto"
        }}
      >
        <p style={{ marginTop: 0, color: "var(--text-muted)" }}>Total: {data?.total ?? 0}</p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)", textAlign: "left" }}>
              <th style={{ padding: "7px 6px" }}>Date</th>
              <th style={{ padding: "7px 6px" }}>Amount</th>
              <th style={{ padding: "7px 6px" }}>Description</th>
              <th style={{ padding: "7px 6px" }}>Source</th>
              <th style={{ padding: "7px 6px" }}>Upload</th>
              <th style={{ padding: "7px 6px" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((item) => (
              <tr key={item.id} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "7px 6px" }}>{formatDate(item.occurred_at)}</td>
                <td style={{ padding: "7px 6px", fontWeight: 600 }}>
                  {item.currency} {item.amount}
                </td>
                <td style={{ padding: "7px 6px" }}>{item.description}</td>
                <td style={{ padding: "7px 6px" }}>{item.source_name}</td>
                <td style={{ padding: "7px 6px" }}>
                  <a href={`/uploads/${item.upload_id}`}>{item.upload_id.slice(0, 10)}...</a>
                </td>
                <td style={{ padding: "7px 6px" }}>
                  <a href={`/rows/${item.row_sha256}?upload_id=${item.upload_id}`}>View Row</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
