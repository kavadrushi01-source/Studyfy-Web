"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { DataTable } from "../../components/ui/data-table";
import { SkeletonBlocks } from "../../components/ui/shell";
import { useAuth } from "@/lib/auth-context";

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

// Roster screen (Phase 1 Chunk 1). Every control — search, sort headers,
// pager — hits the server-side table controls on
// GET /schools/:schoolId/students; teachers automatically see only their
// own sections (classTeacherId), enforced API-side, not here.
// Identity comes from the shared session (useAuth): school + bearer token
// are attached by apiFetch, which also refreshes silently.
// Role-agnostic staff page: NOT wrapped in Shell (Shell requires a role
// prop — forcing one would badge the wrong role), so this page carries the
// light-canvas background, Inter font, and 1120/padding-28 rhythm directly.
// NOTE: DataTable's onSort/onPage/page/totalPages/total props are required
// by its API (see components/ui/data-table.tsx), so the live handlers stay
// wired here — DataTable itself is unchanged. Its internal skeleton rows
// cover loading and its internal empty state covers no-results.
export default function StudentsPage() {
  const { token, schoolId, ready, apiFetch } = useAuth();
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
      if (!schoolId) {
        return;
      }
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          search: next.search,
          sort: next.sort,
          order: next.order,
          page: String(next.page),
          pageSize: "10",
        });
        const response = await apiFetch(`/api/v1/schools/${schoolId}/students?${params}`);
        const body = (await response.json()) as ListResponse;
        if (!response.ok || body.error) {
          setError(body.error?.message ?? `Request failed (${response.status}).`);
          return;
        }
        setRows(body.data.students);
        setMeta({ total: body.meta.total, totalPages: body.meta.totalPages });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setLoading(false);
      }
    },
    [schoolId, apiFetch],
  );

  useEffect(() => {
    if (!ready || !token || !schoolId) {
      return;
    }
    void load({ search: "", sort: "name", order: "asc", page: 1 });
  }, [ready, token, schoolId, apiFetch, load]);

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

  const frame = {
    maxWidth: 1120,
    margin: "0 auto",
    padding: 28,
    fontFamily: "Inter, system-ui, sans-serif",
    background: "#F8FAFC",
    minHeight: "100vh",
  } as const;

  if (!ready) {
    return (
      <main style={frame}>
        <h1 style={{ color: "#0F172A" }}>Students</h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={frame}>
        <h1 style={{ color: "#0F172A" }}>Students</h1>
        <div style={{ ...card, maxWidth: 640 }}>
          <p style={{ color: "#334155" }}>Please sign in to view students.</p>
          <Link href="/login" style={{ color: "#2563EB", fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={frame}>
      <h1 style={{ color: "#0F172A" }}>Students</h1>
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
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
