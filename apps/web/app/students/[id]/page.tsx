"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { SkeletonBlocks } from "../../../components/ui/shell";
import { isFailure } from "../../../lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  cardStyle,
  colors,
  gradients,
  h1Style,
  h2Style,
  labelStyle,
  mutedStyle,
  pageFrame,
  pill,
} from "@/lib/theme";

interface Guardian {
  relationship: string;
  parent: { name: string; email: string };
}

interface StudentProfile {
  id: string;
  sectionId: string;
  admissionNo: string | null;
  rollNumber: number | null;
  dob: string | null;
  gender: string | null;
  user: { name: string; email: string };
  guardianLinks: Guardian[];
}

interface ApiError {
  error: { code: string; message: string };
}

// Profile screen (Phase 1 Chunk 1). What you see is decided server-side by
// self-scope: a student gets their own record, a parent their linked
// children, staff any in-school record — anything else is a 403 from the
// API, and this screen surfaces that message as-is. Identity comes from
// the shared session (useAuth) — apiFetch attaches the bearer token.
// Role-agnostic page: NOT wrapped in Shell (Shell requires a role prop —
// forcing one would badge the wrong role), so this page carries the
// light-canvas background, Inter font, and 1120/padding-28 rhythm directly.
export default function StudentProfilePage() {
  const { token, schoolId, ready, apiFetch } = useAuth();
  const [studentId, setStudentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [error, setError] = useState("");

  async function onLoad(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId) {
      setError("Please sign in to load a profile.");
      return;
    }
    setLoading(true);
    setProfile(null);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/students/${studentId}`);
      const body = (await response.json()) as { data: { student: StudentProfile } } | ApiError;
      if (isFailure(response, body)) {
        setError((body as ApiError).error?.message ?? `Request failed (${response.status}).`);
        return;
      }
      setProfile((body as { data: { student: StudentProfile } }).data.student);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
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
  const avatarTile: React.CSSProperties = {
    width: 52,
    height: 52,
    flexShrink: 0,
    borderRadius: 15,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: gradients.accent,
    color: "#fff",
    fontWeight: 800,
    fontSize: 18,
    letterSpacing: "-0.02em",
    boxShadow: "0 10px 22px -10px rgba(37,99,235,.6), inset 0 1px 0 rgba(255,255,255,.25)",
  };
  const dtStyle: React.CSSProperties = {
    margin: 0,
    padding: "10px 0",
    borderBottom: `1px solid ${colors.lineSoft}`,
    fontSize: 13,
    fontWeight: 600,
    color: colors.muted,
  };
  const ddStyle: React.CSSProperties = {
    margin: 0,
    padding: "10px 0",
    borderBottom: `1px solid ${colors.lineSoft}`,
    fontSize: 14,
    fontWeight: 600,
    color: colors.ink,
    textAlign: "right",
    overflowWrap: "anywhere",
  };
  const guardianHeading: React.CSSProperties = {
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: "-0.015em",
    margin: "20px 0 4px",
    color: colors.ink,
  };
  const guardianRow: React.CSSProperties = {
    padding: "10px 0",
    borderTop: `1px solid ${colors.lineSoft}`,
    fontSize: 14,
    color: colors.inkSoft,
  };

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={pageH1}>Student Profile</h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={pageH1}>Student Profile</h1>
        <div style={{ ...cardStyle, maxWidth: 640 }}>
          <p style={{ ...mutedStyle, margin: "0 0 8px" }}>Please sign in to view a profile.</p>
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
      <h1 style={pageH1}>Student Profile</h1>
      <form
        onSubmit={onLoad}
        className="sf-card"
        style={{ maxWidth: 640, padding: 20, display: "grid", gap: 14 }}
      >
        <label style={labelStyle}>
          Student ID
          <input
            className="sf-input"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            required
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="sf-btn sf-btn-primary"
          style={{ justifySelf: "start" }}
        >
          Load profile
        </button>
      </form>
      {loading ? (
        <div style={{ marginTop: 16, maxWidth: 640 }}>
          <SkeletonBlocks rows={4} />
        </div>
      ) : null}
      {error ? (
        <p role="alert" style={alertStyle}>
          {error}
        </p>
      ) : null}
      {profile ? (
        <section style={{ ...cardStyle, marginTop: 16, maxWidth: 640 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={avatarTile}>
              {profile.user.name
                .split(" ")
                .map((p) => p[0] ?? "")
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ ...h2Style, fontSize: 20, margin: 0 }}>{profile.user.name}</h2>
              <p style={{ ...mutedStyle, margin: "2px 0 0" }}>{profile.user.email}</p>
            </div>
          </div>
          <dl
            style={{
              margin: "14px 0 0",
              display: "grid",
              gridTemplateColumns: "auto minmax(0, 1fr)",
              columnGap: 16,
            }}
          >
            <dt style={dtStyle}>Admission no.</dt>
            <dd style={ddStyle}>{profile.admissionNo ?? "—"}</dd>
            <dt style={dtStyle}>Roll no.</dt>
            <dd style={ddStyle}>{profile.rollNumber ?? "—"}</dd>
            <dt style={dtStyle}>Date of birth</dt>
            <dd style={ddStyle}>
              {profile.dob ? new Date(profile.dob).toLocaleDateString("en-GB") : "—"}
            </dd>
            <dt style={dtStyle}>Gender</dt>
            <dd style={ddStyle}>
              {profile.gender ? (
                <span style={pill(colors.primary, colors.primaryGhost)}>{profile.gender}</span>
              ) : (
                "—"
              )}
            </dd>
          </dl>
          <h3 style={guardianHeading}>Guardians</h3>
          {profile.guardianLinks.length === 0 ? (
            <p style={{ ...mutedStyle, margin: 0 }}>None linked.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid" }}>
              {profile.guardianLinks.map((g) => (
                <li key={g.parent.email} style={guardianRow}>
                  {g.parent.name} <span style={pill(colors.accent, colors.accentTint)}>({g.relationship})</span> — {g.parent.email}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </main>
  );
}
