"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SkeletonBlocks } from "../../../../components/ui/shell";
import { isFailure } from "../../../../lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  cardStyle,
  colors,
  gradients,
  h1Style,
  labelStyle,
  mutedStyle,
  pageFrame,
  shadows,
} from "@/lib/theme";

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
  // Student comes from the route (/students/:id/id-card) - no paste box.
  const params = useParams<{ id: string }>();
  const studentId = typeof params.id === "string" ? params.id : "";
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

  const pageH1 = { ...h1Style, marginBottom: 14 };
  const alertStyle = {
    margin: "14px 0 0",
    padding: "10px 14px",
    borderRadius: 12,
    background: colors.dangerTint,
    border: "1px solid rgba(220,38,38,.28)",
    color: colors.danger,
    fontSize: 14,
  };

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={pageH1}>ID Card — Print</h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={pageH1}>ID Card — Print</h1>
        <div className="no-print" style={{ ...cardStyle, maxWidth: 640 }}>
          <p style={{ ...mutedStyle, margin: "0 0 8px" }}>Please sign in to print an ID card.</p>
          <Link
            href="/login"
            style={{ color: colors.primary, fontWeight: 600, fontSize: 14, textDecoration: "none" }}
          >
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
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
        <h1 style={pageH1}>ID Card — Print</h1>
        <form
          onSubmit={onLoad}
          className="sf-card"
          style={{ padding: 20, display: "grid", gap: 14 }}
        >
          <label style={labelStyle}>
            School name (as printed)
            <input
              className="sf-input"
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              required
            />
          </label>
          <div>
            <button type="submit" className="sf-btn sf-btn-secondary">
              Load card
            </button>
          </div>
        </form>
        {error ? (
          <p role="alert" style={alertStyle}>
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
              borderRadius: 13,
              overflow: "hidden",
              boxShadow: shadows.card,
              border: `1px solid ${colors.line}`,
              marginTop: 16,
            }}
          >
            <div style={{ background: "#0F172A", color: "#fff", padding: "7px 11px" }}>
              <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: "-0.01em" }}>
                {schoolName}
              </div>
              <div style={{ fontSize: 9, letterSpacing: 1, opacity: 0.85 }}>
                STUDENT IDENTITY CARD
              </div>
            </div>
            <div style={{ height: 3, background: gradients.accent }} />
            <div style={{ display: "flex", gap: 10, padding: 10 }}>
              <div
                style={{
                  width: 56,
                  height: 66,
                  borderRadius: 10,
                  background: colors.primaryGhost,
                  border: "1px solid #D7E4FB",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 800,
                  color: colors.primary,
                  fontSize: 20,
                  letterSpacing: "-0.02em",
                  flexShrink: 0,
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
                <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: "-0.01em" }}>
                  {profile.user.name}
                </div>
                <div>Adm. no: {profile.admissionNo ?? "—"}</div>
                <div>
                  Class: {profile.section.class.name} · {profile.section.name}
                </div>
                <div>DOB: {profile.dob ? new Date(profile.dob).toLocaleDateString("en-GB") : "—"}</div>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="no-print sf-btn sf-btn-primary"
            style={{ marginTop: 12 }}
            onClick={() => window.print()}
          >
            Print card
          </button>
        </>
      ) : null}
    </main>
  );
}
