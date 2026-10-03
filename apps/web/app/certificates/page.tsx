"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Award } from "lucide-react";
import { DataTable } from "../../components/ui/data-table";
import { SkeletonBlocks } from "../../components/ui/shell";
import { isFailure } from "../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, labelStyle, mutedStyle, pageFrame, pill, primaryBtn, secondaryBtn } from "@/lib/theme";

const TYPES = ["BONAFIDE", "TRANSFER", "CHARACTER"] as const;

interface CertRow {
  id: string;
  type: string;
  serial: string;
  student: { id: string; name: string };
  issuer: { name: string };
  createdAt: string;
}

interface PupilOption {
  id: string;
  name: string;
}

interface ApiError {
  error: { code: string; message: string };
}

// Certificates (§7 Phase 2 #17): office issues Bonafide / Transfer /
// Character PDFs with a frozen snapshot + CERT/<year>/<sequence> serial;
// the log re-downloads exactly what was issued. Admins and accountants
// share this page (the API enforces certificates.manage/read).
export default function CertificatesPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const canManage = user?.role === "SCHOOL_ADMIN" || user?.role === "ACCOUNTANT";
  const [rows, setRows] = useState<CertRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<PupilOption[]>([]);
  const [studentId, setStudentId] = useState("");
  const [certType, setCertType] = useState<string>("BONAFIDE");

  const load = useCallback(
    async (nextPage: number) => {
      if (!schoolId) {
        return;
      }
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(nextPage), pageSize: "20" });
        const response = await apiFetch(`/api/v1/schools/${schoolId}/certificates?${params}`);
        const body = (await response.json()) as {
          data: { certificates: CertRow[]; total: number; totalPages: number };
        } | ApiError;
        if (isFailure(response, body)) {
          throw new Error(body.error?.message ?? "Failed to load certificates.");
        }
        setRows(body.data.certificates);
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

  useEffect(() => {
    if (!ready || !token || !schoolId) {
      return;
    }
    void load(1);
  }, [ready, token, schoolId, apiFetch, load]);

  async function searchPupils(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId || !query.trim()) {
      return;
    }
    setError("");
    try {
      const params = new URLSearchParams({ search: query.trim(), pageSize: "10", sort: "name", order: "asc" });
      const response = await apiFetch(`/api/v1/schools/${schoolId}/students?${params}`);
      const body = (await response.json()) as {
        data: { students: { id: string; user: { name: string } }[] };
      } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Search failed.");
      }
      setOptions(body.data.students.map((s) => ({ id: s.id, name: s.user.name })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  async function issue(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId || !studentId || !certType) {
      return;
    }
    setIssuing(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/certificates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, type: certType }),
      });
      const body = (await response.json()) as { data: { certificate: { id: string; serial: string } } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Issue failed.");
      }
      setNotice(`Issued ${body.data.certificate.serial} — opening the PDF…`);
      await openPdf(body.data.certificate.id);
      setPage(1);
      await load(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setIssuing(false);
    }
  }

  // The PDF endpoint takes a Bearer token, and the API lives on its own
  // origin — so fetch the bytes with the session and open the blob (same
  // print path as fee receipts: the browser's own print dialog).
  async function openPdf(id: string): Promise<void> {
    if (!schoolId) {
      return;
    }
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/certificates/${id}/pdf`);
      if (!response.ok) {
        throw new Error("Could not open the PDF.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      const win = window.open(url, "_blank");
      if (win) {
        win.opener = null;
      } else {
        setError("PDF is ready, but the browser blocked the new tab — allow pop-ups for this site and try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  function changePage(next: number): void {
    setPage(next);
    void load(next);
  }

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Certificates</h1>
        <SkeletonBlocks rows={3} height={52} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Certificates</h1>
        <p style={{ ...mutedStyle, margin: "0 0 12px" }}>Please sign in to issue certificates.</p>
        <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
          Go to login
        </Link>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={{ ...h1Style, display: "flex", alignItems: "center", gap: 8 }}>
        <Award size={22} aria-hidden="true" color={colors.primary} /> Certificates
      </h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        Bonafide, Transfer and Character PDFs — numbered CERT/year/sequence, re-downloadable forever.
      </p>
      {canManage ? (
        <section className="sf-card" style={{ padding: 20, marginBottom: 16 }}>
          <h2 style={{ ...h1Style, fontSize: 18, margin: "0 0 12px" }}>Issue a certificate</h2>
          <form onSubmit={searchPupils} className="sf-row-wrap" style={{ marginBottom: 12 }}>
            <input
              className="sf-input"
              style={{ flex: 1, minWidth: 200 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pupil by name…"
              aria-label="Search pupil"
            />
            <button type="submit" style={secondaryBtn}>
              Search
            </button>
          </form>
          <form onSubmit={issue} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="sf-row-wrap">
              <label style={{ ...labelStyle, flex: 2, minWidth: 200 }}>
                Pupil
                <select
                  className="sf-select"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  required
                  aria-label="Pupil"
                >
                  <option value="">— pick a pupil —</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ ...labelStyle, flex: 1, minWidth: 180 }}>
                Type
                <select
                  className="sf-select"
                  value={certType}
                  onChange={(e) => setCertType(e.target.value)}
                  aria-label="Certificate type"
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0) + t.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <button type="submit" disabled={issuing || !studentId} style={{ ...primaryBtn, opacity: issuing ? 0.6 : 1 }}>
                {issuing ? "Issuing…" : "Issue & open PDF"}
              </button>
            </div>
          </form>
        </section>
      ) : null}
      <DataTable<CertRow>
        columns={[
          { key: "serial", label: "Serial", render: (r) => <span style={{ fontWeight: 600, fontFamily: "monospace" }}>{r.serial}</span> },
          { key: "student", label: "Pupil", render: (r) => <span>{r.student.name}</span> },
          { key: "type", label: "Type", render: (r) => <span style={pill(colors.primary, colors.primaryGhost)}>{r.type}</span> },
          { key: "issuer", label: "Issued by", render: (r) => <span style={{ color: colors.inkSoft }}>{r.issuer.name}</span> },
          {
            key: "pdf",
            label: "PDF",
            render: (r) => (
              <span style={{ display: "inline-flex", gap: 8 }}>
                <button type="button" onClick={() => void openPdf(r.id)} style={{ ...secondaryBtn, padding: "6px 14px", fontSize: 13 }}>
                  Open
                </button>
                <Link
                  href={`/certificates/${r.id}/print`}
                  style={{ ...secondaryBtn, padding: "6px 14px", fontSize: 13, textDecoration: "none" }}
                >
                  Print
                </Link>
              </span>
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
        emptyMessage="No certificates issued yet — issue the first one above."
      />
      {notice ? <p style={{ color: colors.success, fontSize: 14, margin: "12px 0 0" }}>{notice}</p> : null}
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
