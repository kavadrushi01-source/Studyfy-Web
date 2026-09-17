import type { ReactNode } from "react";

export interface DataTableColumn<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort: string;
  order: "asc" | "desc";
  onSort: (key: string) => void;
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
  // Skeleton rows while loading (§8.5/RULES.md §5 — never spinners).
  loading: boolean;
}

// Shared table language from the design boards (§8.2): white card,
// 12–16px radius, soft shadow, blue sortable headers, quiet pager.
// Every control here drives a server-side query — nothing is faked
// client-side over a full dump (RULES.md §4/§13.6).
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  order,
  onSort,
  page,
  totalPages,
  total,
  onPage,
  loading,
}: DataTableProps<T>): ReactNode {
  const card: React.CSSProperties = {
    background: "#fff",
    borderRadius: 14,
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.08)",
    overflow: "hidden",
  };
  const th: React.CSSProperties = {
    textAlign: "left",
    padding: "10px 12px",
    color: "#2563EB",
    fontSize: 13,
    borderBottom: "1px solid #E2E8F0",
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = { padding: "10px 12px", fontSize: 14, borderBottom: "1px solid #F1F5F9" };

  const body = loading
    ? Array.from({ length: 5 }, (_, i) => (
        <tr key={`skeleton-${i}`}>
          {columns.map((c) => (
            <td key={c.key} style={td}>
              <div style={{ height: 14, borderRadius: 6, background: "#F1F5F9" }} />
            </td>
          ))}
        </tr>
      ))
    : rows.map((row) => (
        <tr key={rowKey(row)}>
          {columns.map((c) => (
            <td key={c.key} style={td}>
              {c.render(row)}
            </td>
          ))}
        </tr>
      ));

  return (
    <div>
      <div style={card}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={th}>
                  {c.sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.key)}
                      style={{ all: "unset", cursor: "pointer", color: "#2563EB", fontWeight: sort === c.key ? 700 : 400 }}
                      aria-sort={sort === c.key ? (order === "asc" ? "ascending" : "descending") : "none"}
                    >
                      {c.label} {sort === c.key ? (order === "asc" ? "▲" : "▼") : ""}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 14 }}>
        <button type="button" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>
          ← Prev
        </button>
        <span>
          Page {page} of {totalPages} · {total} total
        </span>
        <button type="button" disabled={page >= totalPages || loading} onClick={() => onPage(page + 1)}>
          Next →
        </button>
      </div>
    </div>
  );
}
