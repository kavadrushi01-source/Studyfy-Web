"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { SkeletonBlocks } from "../../../../components/ui/shell";
import { isFailure } from "../../../../lib/api";
import { useAuth } from "@/lib/auth-context";

interface Profile {
  user: { name: string; email: string };
  admissionNo: string | null;
  section: { name: string; class: { name: string } };
  dob: string | null;
}

// Printable ID card (spec §8.5: print stylesheets for ID cards). The PDF
// endpoint is the downloadable artifact; this page is the print path —
// same data, CR80-sized card, app chrome hidden in print.
// Identity comes from the shared session (useAuth) — apiFetch attaches the
// bearer token.
// Role-agnostic page: NOT wrapped in Shell (Shell requires a role prop —
// forcing one would badge the wrong role), so this page carries the
// light-canvas background, Inter font, and 1120/padding-28 rhythm directly.
// The school name input starts empty and is required: a placeholder name
// must never be printed on a real card.
export default function IdCardPrintPage() {
  const { token, schoolId, ready, apiFetch } = useAuth();
  const [studentId, setStudentId] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [schoolName, setSchoolName] = useState("");
  const [error, setError] = useState("");

  async function onLoad(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId) {
      setError("Please sign in to load a card.");
      return;
    }
    setError("");
    setProfile(null);
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/students/${studentId}`);
      const body = (await response.json()) as
        | { data: { student: Profile & { section: { class: { name: string } } } } }
        | { error: { message: string } };
      if (isFailure(response, body)) {
        setError(body.error?.message ?? `Request failed (${response.status}).`);
        return;
      }
      setProfile(body.data.student);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  const primaryBtn = {
    background: "#2563EB",
    color: "#fff",
    border: "1px solid #2563EB",
    borderRadius: 8,
    padding: "8px 16px",
    cursor: "pointer",
  } as const;
  const secondaryBtn = {
    background: "#fff",
    color: "#0F172A",
    border: "1px solid #CBD5E1",
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
        <h1 style={{ color: "#0F172A" }}>ID Card — Print</h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={frame}>
        <h1 style={{ color: "#0F172A" }}>ID Card — Print</h1>
        <div className="no-print" style={{ ...card, maxWidth: 640 }}>
          <p style={{ color: "#334155" }}>Please sign in to print an ID card.</p>
          <Link href="/login" style={{ color: "#2563EB", fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={frame}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-card {
            box-shadow: none !important;
            margin: 0 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          @page { size: 3.375in 2.125in; margin: 0; }
        }
      `}</style>
      <div className="no-print" style={{ maxWidth: 640 }}>
        <h1 style={{ color: "#0F172A" }}>ID Card — Print</h1>
        <form onSubmit={onLoad} style={card}>
          <label>
            School name (as printed)
            <input
              style={{ display: "block", width: "100%", margin: "4px 0 12px", padding: 8 }}
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              required
            />
          </label>
          <label>
            Student ID
            <input
              style={{ display: "block", width: "100%", margin: "4px 0 12px", padding: 8 }}
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              required
            />
          </label>
          <button type="submit" style={secondaryBtn}>
            Load card
          </button>
        </form>
        {error ? (
          <p role="alert" style={{ color: "#DC2626" }}>
            {error}
          </p>
        ) : null}
      </div>
      {profile ? (
        <>
          <div
            className="print-card"
            style={{
              width: "3.375in",
              height: "2.125in",
              borderRadius: 12,
              overflow: "hidden",
              boxShadow: "0 1px 3px rgba(15,23,42,.12)",
              border: "1px solid #E2E8F0",
              marginTop: 16,
            }}
          >
            <div style={{ background: "#0F172A", color: "#fff", padding: "6px 10px" }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{schoolName}</div>
              <div style={{ fontSize: 9, letterSpacing: 1 }}>STUDENT IDENTITY CARD</div>
            </div>
            <div style={{ display: "flex", gap: 10, padding: 10 }}>
              <div
                style={{
                  width: 56,
                  height: 66,
                  background: "#F1F5F9",
                  border: "1px solid #CBD5E1",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  color: "#0F172A",
                  fontSize: 20,
                }}
              >
                {profile.user.name
                  .split(" ")
                  .map((p) => p[0] ?? "")
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
              <div style={{ fontSize: 11 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{profile.user.name}</div>
                <div>Adm. no: {profile.admissionNo ?? "—"}</div>
                <div>
                  Class: {profile.section.class.name} · {profile.section.name}
                </div>
                <div>DOB: {profile.dob ? new Date(profile.dob).toLocaleDateString("en-GB") : "—"}</div>
              </div>
            </div>
          </div>
          <button type="button" className="no-print" style={{ ...primaryBtn, marginTop: 12 }} onClick={() => window.print()}>
            Print card
          </button>
        </>
      ) : null}
    </main>
  );
}
