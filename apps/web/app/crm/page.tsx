"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Inbox, UserPlus } from "lucide-react";
import { DataTable } from "../../components/ui/data-table";
import { SkeletonBlocks } from "../../components/ui/shell";
import { isFailure } from "../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, labelStyle, mutedStyle, pageFrame, pill, primaryBtn, secondaryBtn } from "@/lib/theme";

const STAGES = ["NEW", "CONTACTED", "VISITED", "ADMITTED", "REJECTED"] as const;

interface CrmRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  message: string;
  status: string;
  assignee: { id: string; name: string } | null;
  notesCount: number;
  createdAt: string;
  updatedAt: string;
}

interface CrmNote {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string };
}

interface CrmDetail extends Omit<CrmRow, "notesCount"> {
  notes: CrmNote[];
}

interface StaffOption {
  id: string;
  user: { id: string; name: string };
}

interface ApiError {
  error: { code: string; message: string };
}

// Admissions pipeline (§7 Phase 2 #16): the public enquiry form drops rows
// in as NEW; office staff work them through CONTACTED → VISITED → ADMITTED
// (or REJECTED) with an assignee and a follow-up timeline. Admins manage,
// accountants read. Identity comes from the shared session (useAuth).
export default function CrmPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const canManage = user?.role === "SCHOOL_ADMIN";
  const [rows, setRows] = useState<CrmRow[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeId, setActiveId] = useState("");
  const [detail, setDetail] = useState<CrmDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [assigneeId, setAssigneeId] = useState("");

  const load = useCallback(
    async (next: { status: string; search: string; page: number }) => {
      if (!schoolId) {
        return;
      }
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(next.page), pageSize: "20" });
        if (next.status) {
          params.set("status", next.status);
        }
        if (next.search.trim()) {
          params.set("search", next.search.trim());
        }
        const response = await apiFetch(`/api/v1/schools/${schoolId}/enquiries?${params}`);
        const body = (await response.json()) as {
          data: { enquiries: CrmRow[]; totals: Record<string, number>; total: number; totalPages: number };
        } | ApiError;
        if (isFailure(response, body)) {
          throw new Error(body.error?.message ?? "Failed to load enquiries.");
        }
        setRows(body.data.enquiries);
        setTotals(body.data.totals);
        setTotal(body.data.total);
        setTotalPages(body.data.totalPages);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setLoading(false);
      }
    },
    [schoolId, apiFetch],
  );

  const loadDetail = useCallback(
    async (enquiryId: string) => {
      if (!schoolId || !enquiryId) {
        return;
      }
      setDetailLoading(true);
      try {
        const response = await apiFetch(`/api/v1/schools/${schoolId}/enquiries/${enquiryId}`);
        const body = (await response.json()) as { data: { enquiry: CrmDetail } } | ApiError;
        if (isFailure(response, body)) {
          throw new Error(body.error?.message ?? "Failed to load enquiry.");
        }
        setDetail(body.data.enquiry);
        setAssigneeId(body.data.enquiry.assignee?.id ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setDetailLoading(false);
      }
    },
    [schoolId, apiFetch],
  );

  useEffect(() => {
    if (!ready || !token || !schoolId) {
      return;
    }
    void load({ status: "", search: "", page: 1 });
    if (canManage) {
      void (async () => {
        try {
          const response = await apiFetch(`/api/v1/schools/${schoolId}/staff`);
          const body = (await response.json()) as { data: { staff: StaffOption[] } } | ApiError;
          if (!isFailure(response, body)) {
            setStaff(body.data.staff);
          }
        } catch {
          // Assignee picker stays empty — assignment still validates server-side.
        }
      })();
    }
  }, [ready, token, schoolId, apiFetch, load, canManage]);

  function applyFilter(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setPage(1);
    setActiveId("");
    setDetail(null);
    void load({ status, search, page: 1 });
  }

  function changePage(next: number): void {
    setPage(next);
    void load({ status, search, page: next });
  }

  function openRow(id: string): void {
    setActiveId(id);
    setNoteBody("");
    void loadDetail(id);
  }

  async function moveStage(next: string): Promise<void> {
    if (!schoolId || !activeId || !canManage) {
      return;
    }
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/enquiries/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Stage move failed.");
      }
      setNotice(`Moved to ${next} — recorded in the timeline.`);
      await loadDetail(activeId);
      await load({ status, search, page });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  async function saveAssignee(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId || !activeId || !canManage) {
      return;
    }
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/enquiries/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId: assigneeId || null }),
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Assignment failed.");
      }
      setNotice(assigneeId ? "Assigned." : "Back in the unassigned queue.");
      await loadDetail(activeId);
      await load({ status, search, page });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  async function addNote(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId || !activeId || !noteBody.trim() || !canManage) {
      return;
    }
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/enquiries/${activeId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: noteBody.trim() }),
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Note failed.");
      }
      setNoteBody("");
      setNotice("Note added to the timeline.");
      await loadDetail(activeId);
      await load({ status, search, page });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  function stagePill(value: string): React.CSSProperties {
    const tone =
      value === "ADMITTED" ? colors.success : value === "REJECTED" ? colors.danger : value === "NEW" ? colors.warning : colors.primary;
    const tint =
      value === "ADMITTED" ? colors.successTint : value === "REJECTED" ? colors.dangerTint : value === "NEW" ? colors.warningTint : colors.primaryGhost;
    return pill(tone, tint);
  }

  function ageOf(iso: string): string {
    const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
    return days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
  }

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Admissions</h1>
        <SkeletonBlocks rows={3} height={52} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Admissions</h1>
        <p style={{ ...mutedStyle, margin: "0 0 12px" }}>Please sign in to view the pipeline.</p>
        <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
          Go to login
        </Link>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={{ ...h1Style, display: "flex", alignItems: "center", gap: 8 }}>
        <Inbox size={22} aria-hidden="true" color={colors.primary} /> Admissions
      </h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        Enquiry pipeline — public form drops rows in as New; work them to Admitted.
      </p>
      <div className="sf-row-wrap" style={{ gap: 8, marginBottom: 12 }}>
        {(["", ...STAGES] as const).map((s) => (
          <span key={s || "ALL"} style={s ? stagePill(s) : pill(colors.ink, "#F1F5F9")}>
            {s || "All"} · {s ? (totals[s] ?? 0) : total}
          </span>
        ))}
      </div>
      <form onSubmit={applyFilter} className="sf-row-wrap" style={{ marginBottom: 12 }}>
        <select
          className="sf-select"
          style={{ minWidth: 160 }}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by stage"
        >
          <option value="">All stages</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          className="sf-input"
          style={{ flex: 1, minWidth: 200 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, phone, email…"
          aria-label="Search enquiries"
        />
        <button type="submit" style={primaryBtn}>
          Filter
        </button>
      </form>
      <DataTable<CrmRow>
        columns={[
          { key: "name", label: "Name", render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
          {
            key: "contact",
            label: "Contact",
            render: (r) => <span style={{ color: colors.inkSoft }}>{[r.phone, r.email].filter(Boolean).join(" · ") || "—"}</span>,
          },
          { key: "status", label: "Stage", render: (r) => <span style={stagePill(r.status)}>{r.status}</span> },
          { key: "assignee", label: "Owner", render: (r) => <span style={{ color: colors.inkSoft }}>{r.assignee?.name ?? "Unassigned"}</span> },
          { key: "age", label: "Waiting", render: (r) => <span style={{ color: colors.muted }}>{ageOf(r.createdAt)}</span> },
          {
            key: "open",
            label: "Detail",
            render: (r) => (
              <button type="button" onClick={() => openRow(r.id)} style={{ ...secondaryBtn, padding: "6px 14px", fontSize: 13 }}>
                Open
              </button>
            ),
          },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        sort="createdAt"
        order="desc"
        onSort={() => undefined}
        page={page}
        totalPages={totalPages}
        total={total}
        onPage={changePage}
        loading={loading}
        emptyMessage="No enquiries at this stage yet — they arrive from the public enquiry form."
      />
      {activeId && (!detail || detailLoading) ? (
        <div style={{ marginTop: 16 }}>
          <SkeletonBlocks rows={3} height={52} />
        </div>
      ) : null}
      {activeId && detail ? (
        <section className="sf-card" style={{ padding: 20, marginTop: 16 }}>
          <h2 style={{ ...h1Style, fontSize: 18, margin: "0 0 4px" }}>{detail.name}</h2>
          <p style={{ ...mutedStyle, fontSize: 13, margin: "0 0 12px" }}>
            {[detail.phone, detail.email].filter(Boolean).join(" · ")} — <span style={stagePill(detail.status)}>{detail.status}</span>{" "}
            · owner {detail.assignee?.name ?? "unassigned"}
          </p>
          <p style={{ fontSize: 14, color: colors.inkSoft, lineHeight: 1.6, margin: "0 0 12px" }}>{detail.message}</p>
          <Link
            href="/students/new"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, color: colors.primary, fontWeight: 600, fontSize: 14, textDecoration: "none", marginBottom: 16 }}
          >
            <UserPlus size={14} aria-hidden="true" /> Admit — open admission form
          </Link>
          <h3 style={{ ...h1Style, fontSize: 15, margin: "0 0 8px" }}>Timeline</h3>
          {detail.notes.length === 0 ? (
            <p style={{ ...mutedStyle, fontSize: 13 }}>No follow-ups yet.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: "0 0 16px", padding: 0, display: "grid", gap: 8 }}>
              {detail.notes.map((n) => (
                <li
                  key={n.id}
                  style={{ padding: "10px 12px", borderRadius: 10, background: "#F8FAFD", border: `1px solid ${colors.lineSoft}`, fontSize: 13 }}
                >
                  <div style={{ color: colors.ink }}>{n.body}</div>
                  <div style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                    {n.author.name} · {new Date(n.createdAt).toLocaleString("en-GB")}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <>
              <div className="sf-row-wrap" style={{ gap: 8, marginBottom: 12 }} role="group" aria-label="Move stage">
                {STAGES.filter((s) => s !== detail.status).map((s) => (
                  <button key={s} type="button" onClick={() => void moveStage(s)} style={secondaryBtn}>
                    → {s}
                  </button>
                ))}
              </div>
              <form onSubmit={saveAssignee} className="sf-row-wrap" style={{ marginBottom: 12 }}>
                <select
                  className="sf-select"
                  style={{ flex: 1, minWidth: 200 }}
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  aria-label="Assign owner"
                >
                  <option value="">Unassigned queue</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.user.id}>
                      {s.user.name}
                    </option>
                  ))}
                </select>
                <button type="submit" style={secondaryBtn}>
                  Assign
                </button>
              </form>
              <form onSubmit={addNote} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <label style={{ ...labelStyle }}>
                  Follow-up note
                  <textarea
                    className="sf-textarea"
                    style={{ minHeight: 64 }}
                    value={noteBody}
                    onChange={(e) => setNoteBody(e.target.value)}
                    placeholder="Called the parents — visiting Saturday…"
                    aria-label="Follow-up note"
                  />
                </label>
                <div>
                  <button type="submit" style={primaryBtn}>
                    Add note
                  </button>
                </div>
              </form>
            </>
          ) : (
            <p style={{ ...mutedStyle, fontSize: 13 }}>Read-only for your role — stage moves belong to the school admin.</p>
          )}
        </section>
      ) : null}
      {notice ? <p style={{ color: colors.success, fontSize: 14, margin: "12px 0 0" }}>{notice}</p> : null}
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
