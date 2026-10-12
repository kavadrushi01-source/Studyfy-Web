"use client";

import { useState, type ChangeEvent } from "react";
import Link from "next/link";
import { FileUp } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { cardStyle, colors, h1Style, mutedStyle, pageFrame, primaryBtn } from "@/lib/theme";
import { isFailure } from "../../../lib/api";
import { EmptyState, SkeletonBlocks } from "../../../components/ui/shell";

interface ImportedRow {
  row: number;
  studentId: string;
  name: string;
  email: string;
  studentTempPassword: string;
  guardians: { name: string; email: string; tempPassword: string | null }[];
}

interface RefusedRow {
  row: number;
  email: string | null;
  code: string;
  message: string;
}

interface ImportReport {
  summary: { total: number; imported: number; refused: number };
  imported: ImportedRow[];
  refused: RefusedRow[];
}

interface ApiError {
  error: { code: string; message: string };
}

// Bulk CSV import (§7 Phase 0, §16.1): School Admin uploads one file; the
// server admits row by row through the SAME admission flow as the front
// desk (temp passwords, guardian reuse, plan cap, USER_CREATE audit) and
// reports every row — imported or refused with its exact reason. Nothing
// silent, nothing half-created per row. Temp passwords print ONCE here:
// hand them to families now, they are never shown again.
export default function StudentsImportPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const canView = user?.role === "SCHOOL_ADMIN";
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);

  function pickFile(event: ChangeEvent<HTMLInputElement>): void {
    setFile(event.target.files?.[0] ?? null);
    setError("");
    setReport(null);
  }

  async function upload(): Promise<void> {
    if (!schoolId || !file) {
      return;
    }
    setUploading(true);
    setError("");
    setReport(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const response = await apiFetch(`/api/v1/schools/${schoolId}/students/import`, { method: "POST", body: form });
      const body = (await response.json()) as { data: ImportReport } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? `Import failed (${response.status}).`);
      }
      setReport(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setUploading(false);
    }
  }

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, marginBottom: 14 }}>Import students</h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId || !canView) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Import students</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: 0 }}>Bulk import lives with the School Admin.</p>
        </div>
      </main>
    );
  }

  const th: React.CSSProperties = { textAlign: "left", fontSize: 12, color: colors.muted, fontWeight: 700, padding: "8px 10px" };
  const td: React.CSSProperties = { fontSize: 14, color: colors.ink, padding: "8px 10px", borderTop: "1px solid rgba(15,23,42,.08)" };
  const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace", fontSize: 13 };

  return (
    <main style={pageFrame}>
      <h1 style={h1Style}>Import students</h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        Upload a CSV file — each row is admitted like a front-desk admission, and every row is reported back.{" "}
        <Link href="/students" style={{ color: colors.primary, fontWeight: 600, textDecoration: "none" }}>
          Back to students
        </Link>
      </p>

      <div className="sf-card" style={{ ...cardStyle, marginBottom: 16 }}>
        <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 6px", color: colors.ink }}>File format</p>
        <p style={{ ...mutedStyle, fontSize: 13, margin: "0 0 4px" }}>
          Header (exact):{" "}
          <span style={mono}>
            StudentName,StudentEmail,Section,AdmissionNo,GuardianName,GuardianEmail,GuardianRelationship
          </span>
        </p>
        <p style={{ ...mutedStyle, fontSize: 13, margin: "0 0 4px" }}>
          Section looks like <span style={mono}>Grade 9-A</span> (Class-Section). AdmissionNo and GuardianRelationship
          may be blank. Max 2 MB, max 500 rows. Rows past the plan cap are refused, never silently dropped.
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <input type="file" accept=".csv" onChange={pickFile} aria-label="CSV file to import" />
          <button type="button" style={primaryBtn} disabled={!file || uploading} onClick={() => void upload()}>
            {uploading ? "Importing…" : "Upload and import"}
          </button>
        </div>
        {file ? (
          <p style={{ ...mutedStyle, fontSize: 13, margin: "8px 0 0" }}>Selected: {file.name}</p>
        ) : null}
      </div>

      {error ? (
        <div className="sf-card" style={{ padding: 16, borderLeft: `4px solid ${colors.danger}` }}>
          <strong style={{ color: colors.danger }}>Import failed.</strong>
          <p style={{ ...mutedStyle, fontSize: 14, margin: "6px 0 0" }}>{error}</p>
        </div>
      ) : null}

      {report ? (
        <div>
          <div className="sf-card" style={{ ...cardStyle, marginBottom: 16 }}>
            <p style={{ fontSize: 15, fontWeight: 700, margin: 0, color: colors.ink }}>
              {report.summary.imported} imported · {report.summary.refused} refused · {report.summary.total} rows
            </p>
          </div>

          {report.refused.length > 0 ? (
            <div className="sf-card" style={{ ...cardStyle, marginBottom: 16 }}>
              <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: colors.danger }}>
                Refused rows — fix and re-upload just these
              </p>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Row</th>
                    <th style={th}>Email</th>
                    <th style={th}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {report.refused.map((r) => (
                    <tr key={r.row}>
                      <td style={td}>{r.row}</td>
                      <td style={{ ...td, ...mono }}>{r.email ?? "—"}</td>
                      <td style={td}>{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {report.imported.length > 0 ? (
            <div className="sf-card" style={{ ...cardStyle, marginBottom: 16 }}>
              <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px", color: colors.ink }}>Imported</p>
              <p style={{ ...mutedStyle, fontSize: 13, margin: "0 0 8px" }}>
                Temporary passwords print once, here only — hand them to families now.
              </p>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Row</th>
                    <th style={th}>Name</th>
                    <th style={th}>Login password</th>
                    <th style={th}>Guardian password</th>
                  </tr>
                </thead>
                <tbody>
                  {report.imported.map((r) => (
                    <tr key={r.row}>
                      <td style={td}>{r.row}</td>
                      <td style={td}>{r.name}</td>
                      <td style={{ ...td, ...mono }}>{r.studentTempPassword}</td>
                      <td style={{ ...td, ...mono }}>
                        {r.guardians.map((g) => g.tempPassword ?? "(kept)").join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={<FileUp size={20} />} title="Nothing imported" detail="Every row was refused — see the table above." />
          )}
        </div>
      ) : null}
    </main>
  );
}
