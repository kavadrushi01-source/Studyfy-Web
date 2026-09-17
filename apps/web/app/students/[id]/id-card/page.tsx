"use client";

import { useState, type FormEvent } from "react";

interface Profile {
  user: { name: string; email: string };
  admissionNo: string | null;
  section: { name: string; class: { name: string } };
  dob: string | null;
}

// Printable ID card (spec §8.5: print stylesheets for ID cards). The PDF
// endpoint is the downloadable artifact; this page is the print path —
// same data, CR80-sized card, app chrome hidden in print.
export default function IdCardPrintPage() {
  const [schoolId, setSchoolId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [token, setToken] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [schoolName, setSchoolName] = useState("Studyfy School");
  const [error, setError] = useState("");

  async function onLoad(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setProfile(null);
    try {
      const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const response = await fetch(`${api}/api/v1/schools/${schoolId}/students/${studentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await response.json()) as
        | { data: { student: Profile & { section: { class: { name: string } } } } }
        | { error: { message: string } };
      if (!response.ok || "error" in body) {
        const message = "error" in body ? (body.error?.message ?? `Request failed (${response.status}).`) : `Request failed (${response.status}).`;
        setError(message);
        return;
      }
      setProfile(body.data.student);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  return (
    <main style={{ maxWidth: 560, margin: "32px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
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
      <div className="no-print">
        <h1>ID Card — Print</h1>
        <form onSubmit={onLoad}>
          <label>
            School name (printed header)
            <input
              style={{ display: "block", width: "100%", margin: "4px 0 12px", padding: 8 }}
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
            />
          </label>
          <label>
            School ID
            <input
              style={{ display: "block", width: "100%", margin: "4px 0 12px", padding: 8 }}
              value={schoolId}
              onChange={(e) => setSchoolId(e.target.value)}
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
          <label>
            Bearer token (dev only)
            <input
              style={{ display: "block", width: "100%", margin: "4px 0 12px", padding: 8 }}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
          </label>
          <button type="submit">Load card</button>
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
            <div style={{ background: "#0D9488", color: "#fff", padding: "6px 10px" }}>
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
                  color: "#0D9488",
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
          <button type="button" className="no-print" style={{ marginTop: 12 }} onClick={() => window.print()}>
            Print card
          </button>
        </>
      ) : null}
    </main>
  );
}
