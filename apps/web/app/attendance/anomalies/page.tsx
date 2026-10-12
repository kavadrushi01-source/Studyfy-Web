"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { EmptyState, SkeletonBlocks, UpgradeLocked } from "../../../components/ui/shell";
import { isFailure, upgradeLockedMessage } from "../../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, h2Style, labelStyle, mutedStyle, pageFrame, pill, primaryBtn } from "@/lib/theme";

interface SectionOption {
  id: string;
  name: string;
  class: { name: string };
}

interface Anomaly {
  type: string;
  facts: string;
}

interface FlaggedPupil {
  studentId: string;
  name: string;
  anomalies: Anomaly[];
}

interface ScanResult {
  section: { id: string; name: string };
  windowDays: number;
  range: { from: string; to: string } | null;
  checked: number;
  flagged: FlaggedPupil[];
  summary: string | null;
  summaryStatus: "ok" | "unconfigured" | "failed";
}

interface ApiError {
  error: { code: string; message: string };
}

const TYPE_LABELS: Record<string, string> = {
  CONSECUTIVE_ABSENCES: "Consecutive absences",
  HIGH_ABSENCE_RATE: "High absence rate",
  DECLINING_TREND: "Declining trend",
  FREQUENT_LATES: "Frequent lates",
};

const TYPE_TONE: Record<string, "danger" | "warning"> = {
  CONSECUTIVE_ABSENCES: "danger",
  HIGH_ABSENCE_RATE: "danger",
  DECLINING_TREND: "warning",
  FREQUENT_LATES: "warning",
};

// Absence alerts (§7 Phase 3 #18): the detector runs server-side over one
// section's trailing marked days; this page shows the flagged pupils with
// the AI-phrased section summary. Staff-only — the endpoint refuses
// pupils/parents at the service gate, so the section picker only renders
// for office/teacher roles.
export default function AttendanceAnomaliesPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const canView = user?.role === "SCHOOL_ADMIN" || user?.role === "TEACHER";
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [windowDays, setWindowDays] = useState("10");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Plan-gate locked state (§16.1): a 403 PLAN_UPGRADE_REQUIRED on the main
  // load parks the server's upgrade message here and the page renders the
  // locked card instead of content or a bare error.
  const [locked, setLocked] = useState<string | null>(null);

  const scan = useCallback(
    async (nextSection: string, nextWindow: string) => {
      if (!schoolId || !nextSection) {
        return;
      }
      setLoading(true);
      setError("");
      setLocked(null);
      try {
        const params = new URLSearchParams({ sectionId: nextSection, windowDays: nextWindow });
        const response = await apiFetch(`/api/v1/schools/${schoolId}/attendance/anomalies?${params}`);
        const body = (await response.json()) as { data: ScanResult } | ApiError;
        const upgrade = upgradeLockedMessage(body);
        if (upgrade) {
          setLocked(upgrade);
          return;
        }
        if (isFailure(response, body)) {
          throw new Error(body.error?.message ?? "Failed to scan attendance.");
        }
        setResult(body.data);
      } catch (err) {
        setResult(null);
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setLoading(false);
      }
    },
    [schoolId, apiFetch],
  );

  useEffect(() => {
    if (!ready || !token || !schoolId || !canView) {
      return;
    }
    void (async () => {
      try {
        const response = await apiFetch(`/api/v1/schools/${schoolId}/sections`);
        const body = (await response.json()) as { data: { sections: SectionOption[] } } | ApiError;
        if (!isFailure(response, body)) {
          setSections(body.data.sections);
        }
      } catch {
        // The picker stays empty — the scan validates server-side anyway.
      }
    })();
  }, [ready, token, schoolId, apiFetch, canView]);

  function pickSection(event: React.ChangeEvent<HTMLSelectElement>): void {
    const next = event.target.value;
    setSectionId(next);
    if (next) {
      void scan(next, windowDays);
    } else {
      setResult(null);
    }
  }

  function rescan(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (sectionId) {
      void scan(sectionId, windowDays);
    }
  }

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Absence alerts</h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Absence alerts</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: "0 0 8px" }}>Please sign in to view alerts.</p>
          <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  if (locked) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Absence alerts</h1>
        <UpgradeLocked message={locked} />
      </main>
    );
  }

  if (!canView) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Absence alerts</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: 0 }}>
            Absence alerts are for school staff — your attendance lives on your dashboard.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={h1Style}>Absence alerts</h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        Sliding-window scan of trailing marked days — consecutive absences, high absence rates, declining
        trends, frequent lates.
      </p>
      <form onSubmit={rescan} className="sf-row-wrap" style={{ alignItems: "flex-end", marginBottom: 12 }}>
        <label style={{ ...labelStyle, flex: 1, minWidth: 220 }}>
          Section
          <select className="sf-select" value={sectionId} onChange={pickSection} aria-label="Section">
            <option value="">— pick a section —</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.class.name} · {s.name}
              </option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Window
          <select
            className="sf-select"
            value={windowDays}
            onChange={(e) => setWindowDays(e.target.value)}
            aria-label="Window days"
          >
            <option value="5">5 days</option>
            <option value="10">10 days</option>
            <option value="20">20 days</option>
            <option value="30">30 days</option>
          </select>
        </label>
        <button type="submit" disabled={loading || !sectionId} style={{ ...primaryBtn, opacity: loading || !sectionId ? 0.6 : 1 }}>
          {loading ? "Scanning…" : "Scan"}
        </button>
      </form>
      {result?.range ? (
        <p style={{ ...mutedStyle, margin: "0 0 12px" }}>
          Trailing {result.windowDays} marked days {result.range.from} → {result.range.to} ·{" "}
          {result.checked} {result.checked === 1 ? "pupil" : "pupils"} checked
        </p>
      ) : null}
      {!loading && !result ? (
        <EmptyState
          icon={<BarChart3 size={22} aria-hidden="true" />}
          title="Pick a section to scan"
          detail="Choose a section above — the sliding-window scan runs over its trailing marked days."
        />
      ) : null}
      {loading ? (
        <SkeletonBlocks rows={4} />
      ) : result ? (
        <>
          <section className="sf-card" style={{ padding: 20, marginBottom: 16 }}>
            <h2 style={h2Style}>Summary</h2>
            {result.summary ? (
              <p style={{ color: colors.ink, fontSize: 15, margin: 0 }}>{result.summary}</p>
            ) : result.summaryStatus === "unconfigured" ? (
              <p style={{ ...mutedStyle, fontSize: 14, margin: 0 }}>
                AI summary not configured — the flagged list below is complete without it.
              </p>
            ) : (
              <p style={{ ...mutedStyle, fontSize: 14, margin: 0 }}>
                AI summary unavailable right now — the flagged list below stands on its own.
              </p>
            )}
          </section>
          {result.flagged.length === 0 ? (
            <EmptyState
              icon={<BarChart3 size={22} aria-hidden="true" />}
              title="No attendance concerns in this window"
              detail="Nobody in this section tripped the absence, trend, or late signals — try a wider window."
            />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
              {result.flagged.map((p) => (
                <li key={p.studentId} className="sf-card" style={{ padding: 16 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <strong style={{ color: colors.ink, fontSize: 15 }}>{p.name}</strong>
                    <Link
                      href={`/students/${p.studentId}`}
                      style={{ color: colors.primary, fontWeight: 600, fontSize: 13 }}
                    >
                      View student →
                    </Link>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
                    {p.anomalies.map((a) => {
                      const tone = TYPE_TONE[a.type] ?? "warning";
                      const fg = tone === "danger" ? colors.danger : colors.warning;
                      const bg = tone === "danger" ? colors.dangerTint : colors.warningTint;
                      return (
                        <span key={a.type} style={pill(fg, bg)}>
                          {TYPE_LABELS[a.type] ?? a.type}
                        </span>
                      );
                    })}
                  </div>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: colors.inkSoft, fontSize: 14 }}>
                    {p.anomalies.map((a) => (
                      <li key={a.type}>{a.facts}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
