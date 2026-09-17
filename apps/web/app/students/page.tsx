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

  return (
    <main style={{ maxWidth: 900, margin: "32px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>Students</h1>
      {!connected ? (
        <form onSubmit={connect}>
          <label>
            School ID
            <input style={input} value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required />
          </label>
          <label>
            Bearer token (dev only — login screen replaces this)
            <input style={input} value={token} onChange={(e) => setToken(e.target.value)} required />
          </label>
          <button type="submit">Connect</button>
        </form>
      ) : (
        <>
          <form onSubmit={applySearch} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              style={{ flex: 1, padding: 8 }}
              placeholder="Search name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search students"
            />
            <button type="submit">Search</button>
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
