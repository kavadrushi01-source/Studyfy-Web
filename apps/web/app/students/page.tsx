"use client";

import { useCallback, useState, type FormEvent } from "react";
import { DataTable } from "../../components/ui/data-table";

interface StudentRow {
  id: string;
  admissionNo: string | null;
  user: { name: string; email: string };
  section: { name: string; class: { name: string } };
}

interface ListResponse {
  data: { students: StudentRow[] };
  meta: { total: number; page: number; pageSize: number; totalPages: number };
  error: { code: string; message: string } | null;
}

// Pre-dashboard roster screen (Phase 1 Chunk 1). Every control — search,
// sort headers, pager — hits the server-side table controls on
// GET /schools/:schoolId/students; teachers automatically see only their
// own sections (classTeacherId), enforced API-side, not here.
// Auth UI doesn't exist yet: school + bearer token are pasted (dev
// workflow only — the dashboard shell + login replace this in Chunk 5).
// Role-agnostic staff page: NOT wrapped in Shell (Shell requires a role
// prop — forcing one would badge the wrong role), so this page carries the
// light-canvas background, Inter font, and 1120/padding-28 rhythm directly.
// NOTE: DataTable's onSort/onPage/page/totalPages/total props are required
// by its API (see components/ui/data-table.tsx), so the live handlers stay
// wired here — DataTable itself is unchanged. Its internal skeleton rows
// cover loading and its internal empty state covers no-results.
export default function StudentsPage() {
  const [schoolId, setSchoolId] = useState("");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (next: { search: string; sort: string; order: "asc" | "desc"; page: number }) => {
      setLoading(true);
      setError("");
      try {
        const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
        const params = new URLSearchParams({
          search: next.search,
          sort: next.sort,
          order: next.order,
          page: String(next.page),
          pageSize: "10",
        });
        const response = await fetch(`${api}/api/v1/schools/${schoolId}/students?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = (await response.json()) as ListResponse;
        if (!response.ok || body.error) {
          setError(body.error?.message ?? `Request failed (${response.status}).`);
          return;
        }
        setRows(body.data.students);
        setMeta({ total: body.meta.total, totalPages: body.meta.totalPages });
        setConnected(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setLoading(false);
      }
    },
    [schoolId, token],
  );

  function connect(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setPage(1);
    void load({ search, sort, order, page: 1 });
  }

  function applySearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setPage(1);
    void load({ search, sort, order, page: 1 });
  }

  function changeSort(key: string): void {
    const nextOrder = sort === key && order === "asc" ? "desc" : "asc";
    setSort(key);
    setOrder(nextOrder);
    void load({ search, sort: key, order: nextOrder, page });
  }

  function changePage(next: number): void {
    setPage(next);
    void load({ search, sort, order, page: next });
  }

  const input = { display: "block", width: "100%", margin: "4px 0 12px", padding: 8 } as const;
  const primaryBtn = {
    background: "#2563EB",
    color: "#fff",
    border: "1px solid #2563EB",
    borderRadius: 8,
    padding: "8px 16px",
    cursor: "pointer",
  } as const;
  const card = {
    background: "#fff",
    borderRadius: 16,
    boxShadow: "0 1px 3px rgba(15,23,42,.08)",
    padding: 20,
  } as const;

  return (
    <main
      style={{
        maxWidth: 1120,
        margin: "0 auto",
        padding: 28,
        fontFamily: "Inter, system-ui, sans-serif",
        background: "#F8FAFC",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ color: "#0F172A" }}>Students</h1>
      {!connected ? (
        <form onSubmit={connect} style={{ ...card, maxWidth: 640 }}>
          <label>
            School ID
            <input style={input} value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required />
          </label>
          <label>
            Bearer token (dev only — login screen replaces this)
            <input style={input} value={token} onChange={(e) => setToken(e.target.value)} required />
          </label>
          <button type="submit" style={primaryBtn}>
            Connect
          </button>
        </form>
      ) : (
        <>
          <form onSubmit={applySearch} className="sf-row-wrap" style={{ marginBottom: 12 }}>
            <input
              style={{ flex: 1, minWidth: 200, padding: 8 }}
              placeholder="Search name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search students"
            />
            <button type="submit" style={primaryBtn}>
              Search
            </button>
          </form>
          <DataTable<StudentRow>
            columns={[
              { key: "name", label: "Name", sortable: true, render: (r) => r.user.name },
              { key: "email", label: "Email", sortable: true, render: (r) => r.user.email },
              {
                key: "section",
                label: "Class · Sec",
                render: (r) => `${r.section.class.name} · ${r.section.name}`,
              },
              { key: "admissionNo", label: "Adm. no.", sortable: true, render: (r) => r.admissionNo ?? "—" },
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            sort={sort}
            order={order}
            onSort={changeSort}
            page={page}
            totalPages={meta.totalPages}
            total={meta.total}
            onPage={changePage}
            loading={loading}
            emptyMessage="No students found — try a different search."
          />
        </>
      )}
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
