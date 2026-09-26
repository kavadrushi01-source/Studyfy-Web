import type { ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Inbox } from "lucide-react";
import { shadows } from "@/lib/theme";

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
  // Friendly empty state (§8.5) — shown instead of a blank body.
  emptyMessage?: string;
  // Hide the pager for single-page boards (e.g. ranked exam results).
  // Defaults to true so every existing consumer keeps its pager.
  showPager?: boolean;
}

// Shared table language from the design boards (§8.2): white card,
// soft elevation, tinted uppercase headers, hover rows, quiet pager.
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
  emptyMessage = "No records to show yet.",
  showPager = true,
}: DataTableProps<T>): ReactNode {
  const card: React.CSSProperties = {
    background: "#fff",
    border: "1px solid #E6EBF4",
    borderRadius: 16,
    boxShadow: shadows.card,
    overflow: "hidden",
  };
  const th: React.CSSProperties = {
    textAlign: "left",
    padding: "12px 14px",
    color: "#64748B",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    borderBottom: "1px solid #E6EBF4",
    background: "linear-gradient(180deg, #FAFCFF 0%, #F5F8FD 100%)",
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "12px 14px",
    fontSize: 14,
    color: "#1E293B",
    borderBottom: "1px solid #EFF3F9",
  };

  const body = loading
    ? Array.from({ length: 5 }, (_, i) => (
        <tr key={`skeleton-${i}`}>
          {columns.map((c) => (
            <td key={c.key} style={td}>
              <div
                className="sf-skeleton"
                style={{ height: 14, borderRadius: 6, background: "#EFF3F9" }}
              />
            </td>
          ))}
        </tr>
      ))
    : rows.map((row) => (
        <tr
          key={rowKey(row)}
          style={{ transition: "background 140ms cubic-bezier(.22,1,.36,1)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#F8FAFD";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
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
        <div className="sf-table-scroll">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={th}>
                  {c.sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.key)}
                      style={{
                        all: "unset",
                        cursor: "pointer",
                        color: sort === c.key ? "#2563EB" : "#64748B",
                        fontWeight: 700,
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        transition: "color 140ms cubic-bezier(.22,1,.36,1)",
                      }}
                      aria-sort={sort === c.key ? (order === "asc" ? "ascending" : "descending") : "none"}
                    >
                      {c.label}{" "}
                      {sort === c.key ? (
                        order === "asc" ? (
                          <ChevronUp size={14} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={14} aria-hidden="true" />
                        )
                      ) : null}
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
        {!loading && rows.length === 0 ? (
          <div
            style={{
              borderTop: "1px solid #EFF3F9",
              padding: 28,
              textAlign: "center",
              color: "#64748B",
              fontSize: 14,
              display: "grid",
              gap: 10,
              justifyItems: "center",
            }}
          >
            <span
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                background: "#EFF6FF",
                color: "#2563EB",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Inbox size={22} aria-hidden="true" />
            </span>
            <span>{emptyMessage}</span>
          </div>
        ) : null}
      </div>
      {showPager ? (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginTop: 14,
          fontSize: 13,
          color: "#64748B",
        }}
      >
        <button
          type="button"
          disabled={page <= 1 || loading}
          onClick={() => onPage(page - 1)}
          className="sf-btn sf-btn-secondary"
          style={{ padding: "7px 12px", fontSize: 13 }}
        >
          <ChevronLeft size={14} aria-hidden="true" /> Prev
        </button>
        <span style={{ fontWeight: 600, color: "#1E293B" }}>
          Page {page} of {totalPages} · {total} total
        </span>
        <button
          type="button"
          disabled={page >= totalPages || loading}
          onClick={() => onPage(page + 1)}
          className="sf-btn sf-btn-secondary"
          style={{ padding: "7px 12px", fontSize: 13 }}
        >
          Next <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
      ) : null}
    </div>
  );
}
