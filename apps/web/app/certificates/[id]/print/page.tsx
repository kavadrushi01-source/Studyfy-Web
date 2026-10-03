"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { SkeletonBlocks } from "../../../../components/ui/shell";
import { isFailure } from "../../../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { cardStyle, colors, h1Style, mutedStyle } from "@/lib/theme";

interface CertDetail {
  id: string;
  type: string;
  serial: string;
  payload: {
    schoolName: string;
    studentName: string;
    admissionNo: string | null;
    className: string;
    sectionName: string;
    serial: string;
    issuedDate: string;
    issuerName: string;
  };
  student: { id: string; name: string };
  issuer: { name: string };
  createdAt: string;
}

interface ApiError {
  error: { code: string; message: string };
}

const TITLES: Record<string, string> = {
  BONAFIDE: "Bonafide Certificate",
  TRANSFER: "Transfer Certificate",
  CHARACTER: "Character Certificate",
};

// Printable certificate (§8.5 — same pattern as the ID-card print page):
// the PDF endpoint is the downloadable artifact; this page is the print
// path — same frozen snapshot, formal layout, app chrome hidden in print.
export default function CertificatePrintPage() {
  const { token, schoolId, ready, apiFetch } = useAuth();
  const params = useParams<{ id: string }>();
  const certificateId = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<CertDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ready || !token || !schoolId || !certificateId) {
      return;
    }
    void (async () => {
      try {
        const response = await apiFetch(`/api/v1/schools/${schoolId}/certificates/${certificateId}`);
        const body = (await response.json()) as { data: { certificate: CertDetail } } | ApiError;
        if (isFailure(response, body)) {
          setError(body.error?.message ?? "Could not open this certificate.");
          return;
        }
        setDetail(body.data.certificate);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      }
    })();
  }, [ready, token, schoolId, certificateId, apiFetch]);

  const frame = {
    maxWidth: 720,
    margin: "0 auto",
    padding: "40px 20px",
    fontFamily: "Inter, system-ui, sans-serif",
  } as const;

  if (!ready) {
    return (
      <main style={frame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Certificate</h1>
        <SkeletonBlocks rows={3} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={frame}>
        <h1 style={{ ...h1Style, margin: "0 0 8px" }}>Certificate</h1>
        <p style={{ ...mutedStyle, margin: "0 0 12px" }}>Please sign in to print a certificate.</p>
        <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
          Go to login
        </Link>
      </main>
    );
  }

  if (error || !detail) {
    return (
      <main style={frame}>
        <h1 style={{ ...h1Style, margin: "0 0 8px" }}>Certificate</h1>
        {error ? (
          <p role="alert" style={{ color: colors.danger, fontSize: 14 }}>
            {error}
          </p>
        ) : (
          <SkeletonBlocks rows={3} />
        )}
      </main>
    );
  }

  const p = detail.payload;
  // Same wording as the PDF artifact (lib/certificates.ts bodyLines) —
  // print and download always say the same thing.
  const bodyText =
    detail.type === "BONAFIDE"
      ? `This is to certify that ${p.studentName}${p.admissionNo ? ` (Admission No. ${p.admissionNo})` : ""} is a bonafide student of ${p.schoolName}, ${p.className} ${p.sectionName} during the academic year. This certificate is issued on request for whatever purpose it may serve.`
      : detail.type === "TRANSFER"
        ? `This is to certify that ${p.studentName}${p.admissionNo ? ` (Admission No. ${p.admissionNo})` : ""} was a student of ${p.schoolName}, ${p.className} ${p.sectionName}. The student's record has been closed on request, and this transfer certificate is issued to seek admission elsewhere.`
        : `This is to certify that ${p.studentName}${p.admissionNo ? ` (Admission No. ${p.admissionNo})` : ""}, a student of ${p.schoolName}, ${p.className} ${p.sectionName}, bears a good moral character to the best of our knowledge. We wish the student success in all future endeavours.`;
  return (
    <main style={frame}>
      <style>
        {`@media print {
          .no-print { display: none !important; }
          main { padding: 0 !important; }
        }`}
      </style>
      <div className="no-print" style={{ ...cardStyle, maxWidth: 720, marginBottom: 16 }}>
        <h1 style={{ ...h1Style, margin: "0 0 8px" }}>Certificate — Print</h1>
        <p style={{ ...mutedStyle, margin: "0 0 12px", fontSize: 13 }}>
          {detail.serial} · {p.studentName} — this page prints the frozen issued copy.
        </p>
        <button type="button" onClick={() => window.print()} className="no-print sf-btn sf-btn-primary">
          Print
        </button>{" "}
        <Link href="/certificates" style={{ color: colors.primary, fontWeight: 600, fontSize: 14 }}>
          Back to log
        </Link>
      </div>
      <div
        style={{
          border: `3px double ${colors.primary}`,
          borderRadius: 12,
          padding: "48px 40px",
          background: "#fff",
          textAlign: "center",
        }}
      >
        <div style={{ color: colors.primary, fontWeight: 800, fontSize: 22, letterSpacing: "-0.01em" }}>
          {p.schoolName}
        </div>
        <div style={{ color: colors.ink, fontWeight: 700, fontSize: 17, marginTop: 12 }}>
          {TITLES[detail.type] ?? detail.type}
        </div>
        <div style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>
          Certificate No: {p.serial} · Date: {p.issuedDate}
        </div>
        <p style={{ color: colors.inkSoft, fontSize: 14, lineHeight: 1.9, margin: "28px 0" }}>{bodyText}</p>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 48, fontSize: 13 }}>
          <div style={{ textAlign: "left" }}>
            <div style={{ color: colors.ink, fontWeight: 600 }}>Issued by</div>
            <div style={{ color: colors.muted }}>{p.issuerName}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: colors.ink, fontWeight: 600 }}>Principal</div>
            <div style={{ color: colors.muted }}>{p.schoolName}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
