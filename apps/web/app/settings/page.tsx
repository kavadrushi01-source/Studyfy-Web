"use client";

import { useState } from "react";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { cardStyle, colors, h1Style, mutedStyle, pageFrame, primaryBtn } from "@/lib/theme";
import { EmptyState, SkeletonBlocks } from "../../components/ui/shell";

interface ApiError {
  error: { code: string; message: string };
}

// School settings (§7 #26 export home): the school's own controls. Today
// that is the data-export action (whole-school ZIP, one per hour, audited
// — its rows land on the audit-logs board); the page exists so the action
// has a stable home as settings grow. No Shell here (same shape as the
// audit-logs page): the role boards link in, the page gates itself.
export default function SettingsPage() {
  // schoolSlug is echoed for orientation only (client-known, never trusted
  // for access — every route re-derives school from the token).
  const { token, schoolId, schoolSlug, ready, apiFetch, user } = useAuth();
  const canView = user?.role === "SCHOOL_ADMIN";
  const [exporting, setExporting] = useState(false);
  const [expNotice, setExpNotice] = useState("");
  const [expError, setExpError] = useState("");

  async function exportSchool(): Promise<void> {
    if (!schoolId || exporting) {
      return;
    }
    setExporting(true);
    setExpNotice("");
    setExpError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/exports`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json()) as ApiError;
        throw new Error(body.error?.message ?? "Export failed.");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "studyfy-export.zip";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setExpNotice("Export downloaded — filter DATA_EXPORT on the audit board to see its audit row.");
    } catch (err) {
      setExpError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setExporting(false);
    }
  }

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, marginBottom: 14 }}>Settings</h1>
        <SkeletonBlocks rows={3} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Settings</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: "0 0 8px" }}>Please sign in to view settings.</p>
          <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  if (!canView) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Settings</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: 0 }}>
            Settings live with the School Admin — staff, go through them for exports.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={h1Style}>Settings</h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>School {schoolSlug || schoolId} — data and controls.</p>

      <div className="sf-card" style={{ ...cardStyle, marginBottom: 12 }}>
        <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: colors.ink }}>Data export</p>
        <p style={{ ...mutedStyle, fontSize: 13, margin: "0 0 12px" }}>
          Whole-school ZIP (JSON per table, secrets excluded) — one per hour, always audited.
        </p>
        <div className="sf-row-wrap" style={{ alignItems: "center" }}>
          <button type="button" onClick={() => void exportSchool()} disabled={exporting} style={primaryBtn}>
            {exporting ? "Exporting…" : "Download export"}
          </button>
        </div>
        {expNotice ? <p style={{ color: colors.success, fontSize: 14, margin: "8px 0 0" }}>{expNotice}</p> : null}
        {expError ? (
          <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "8px 0 0" }}>
            {expError}
          </p>
        ) : null}
      </div>

      <EmptyState
        icon={<Settings2 size={20} aria-hidden="true" />}
        title="More settings coming"
        detail="Plan, billing, and school profile live on their own boards today."
      />
    </main>
  );
}
