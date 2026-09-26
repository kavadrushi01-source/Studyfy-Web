"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { EmptyState, SkeletonBlocks } from "../../components/ui/shell";
import { isFailure } from "../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, labelStyle, mutedStyle, pageFrame, primaryBtn, secondaryBtn } from "@/lib/theme";

interface BoardSlot {
  dayOfWeek: number;
  period: number;
  subject: { name: string };
  teacher: { name: string };
  section: { name: string; className: string };
}

interface SectionOption {
  id: string;
  name: string;
  class: { name: string };
}

interface ApiError {
  error: { code: string; message: string };
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Timetable board (§7 Phase 1 #5). Two lenses, one screen: a SECTION board
// (what students/parents see — pinned API-side to their own) and MY
// TIMETABLE (a teacher's own slots — pass your staff ID; the API rejects
// any other teacher's id with a 403, see readBoard). Grid cells show
// subject + teacher; empty cells stay blank, unresolved demand from
// generation simply has no cell (never a crash).
// Identity comes from the shared session (useAuth).
export default function TimetablePage() {
  const { token, schoolId, ready, apiFetch } = useAuth();
  const [mode, setMode] = useState<"section" | "teacher">("section");
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [slots, setSlots] = useState<BoardSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadSections = useCallback(async () => {
    if (!schoolId) {
      throw new Error("Please sign in to view the timetable.");
    }
    // Pupils/parents hold timetable.read but NOT sections.read, so the full
    // list is 403 for them — fall back to the board-scope endpoint, which
    // returns exactly their pinned sections in the same shape.
    const response = await apiFetch(`/api/v1/schools/${schoolId}/sections`);
    const body = (await response.json()) as { data: { sections: SectionOption[] } } | ApiError;
    if (!isFailure(response, body)) {
      return body.data.sections;
    }
    const scoped = await apiFetch(`/api/v1/schools/${schoolId}/timetable/sections`);
    const scopedBody = (await scoped.json()) as { data: { sections: SectionOption[] } } | ApiError;
    if (isFailure(scoped, scopedBody)) {
      throw new Error(scopedBody.error?.message ?? "Failed to load sections.");
    }
    return scopedBody.data.sections;
  }, [schoolId, apiFetch]);

  const loadBoard = useCallback(
    async (params: URLSearchParams) => {
      if (!schoolId) {
        return;
      }
      setLoading(true);
      setError("");
      try {
        const response = await apiFetch(`/api/v1/schools/${schoolId}/timetable?${params}`);
        const body = (await response.json()) as { data: { slots: BoardSlot[] } } | ApiError;
        if (isFailure(response, body)) {
          throw new Error(body.error?.message ?? "Failed to load board.");
        }
        setSlots(body.data.slots);
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
    void (async () => {
      setError("");
      try {
        setSections(await loadSections());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      }
    })();
  }, [ready, token, schoolId, loadSections]);

  function showSection(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (sectionId) {
      void loadBoard(new URLSearchParams({ sectionId }));
    }
  }

  function showMine(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (teacherId) {
      void loadBoard(new URLSearchParams({ teacherId }));
    }
  }

  const days = [...new Set(slots.map((s) => s.dayOfWeek))].sort((a, b) => a - b);
  const periods = [...new Set(slots.map((s) => s.period))].sort((a, b) => a - b);
  const cell = (day: number, period: number): BoardSlot | undefined =>
    slots.find((s) => s.dayOfWeek === day && s.period === period);

  // Deterministic soft tint per subject so the week reads at a glance.
  const subjectTint = (name: string): { bg: string; hover: string } => {
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) {
      hash = (hash * 31 + name.charCodeAt(i)) % 100000;
    }
    switch (hash % 4) {
      case 0:
        return { bg: colors.primaryGhost, hover: "#E0ECFF" };
      case 1:
        return { bg: colors.accentTint, hover: "#EDE8FE" };
      case 2:
        return { bg: colors.successTint, hover: "#DCF7EB" };
      default:
        return { bg: colors.warningTint, hover: "#FDF3D9" };
    }
  };

  const lensBtn = (active: boolean): React.CSSProperties => ({
    ...secondaryBtn,
    borderColor: active ? colors.primary : "#DBE3EF",
    color: active ? colors.primary : colors.inkSoft,
    background: active ? colors.primaryGhost : "#fff",
    fontWeight: active ? 600 : 500,
    boxShadow: active ? "0 2px 10px -8px rgba(37,99,235,.9)" : "0 1px 2px rgba(15,23,42,.05)",
  });
  const th: React.CSSProperties = {
    padding: "11px 14px",
    color: colors.muted,
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    textAlign: "left",
    borderBottom: `1px solid ${colors.line}`,
    background: "linear-gradient(180deg, #FAFCFF 0%, #F5F8FD 100%)",
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "10px 12px",
    fontSize: 13,
    border: `1px solid ${colors.lineSoft}`,
    minWidth: 120,
    verticalAlign: "top",
    transition: "background 160ms cubic-bezier(.22,1,.36,1)",
  };
  const titleStyle: React.CSSProperties = { ...h1Style, display: "flex", alignItems: "center", gap: 8 };

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...titleStyle, margin: "0 0 12px" }}>
          <CalendarDays size={22} aria-hidden="true" color={colors.primary} /> Timetable
        </h1>
        <SkeletonBlocks rows={3} height={48} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...titleStyle, margin: "0 0 12px" }}>
          <CalendarDays size={22} aria-hidden="true" color={colors.primary} /> Timetable
        </h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: "0 0 8px" }}>Please sign in to view the timetable.</p>
          <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={titleStyle}>
        <CalendarDays size={22} aria-hidden="true" color={colors.primary} /> Timetable
      </h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        Section board first — flip the lens for your own teaching week.
      </p>
      <div className="sf-row-wrap" style={{ marginBottom: 12 }} role="group" aria-label="Board lens">
        <button type="button" onClick={() => setMode("section")} style={lensBtn(mode === "section")}>
          Section board
        </button>
        <button type="button" onClick={() => setMode("teacher")} style={lensBtn(mode === "teacher")}>
          My timetable
        </button>
      </div>
      {mode === "section" ? (
        <form onSubmit={showSection} className="sf-row-wrap" style={{ marginBottom: 12 }}>
          <select
            className="sf-select"
            style={{ flex: 1, minWidth: 220 }}
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            aria-label="Section"
          >
            <option value="">— pick a section —</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.class.name} · {s.name}
              </option>
            ))}
          </select>
          <button type="submit" style={primaryBtn}>
            Show
          </button>
        </form>
      ) : (
        <form onSubmit={showMine} style={{ marginBottom: 12 }}>
          <div className="sf-row-wrap">
            <label style={{ ...labelStyle, flex: 1, minWidth: 220 }}>
              My staff ID (dev-only)
              <input
                className="sf-input"
                placeholder="Paste staff ID for now"
                value={teacherId}
                onChange={(e) => setTeacherId(e.target.value)}
                aria-label="My staff ID"
              />
            </label>
            <button type="submit" style={{ ...secondaryBtn, alignSelf: "flex-end" }}>
              Show mine
            </button>
          </div>
          <small style={{ color: colors.muted, fontSize: 12, display: "block", marginTop: 8 }}>
            Login will resolve your identity automatically later — pasting an ID is a dev stopgap only.
          </small>
        </form>
      )}
      {loading ? (
        <SkeletonBlocks rows={3} height={48} />
      ) : slots.length > 0 ? (
        <div className="sf-card" style={{ overflow: "hidden" }}>
          <div className="sf-table-scroll">
            <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
              <thead>
                <tr>
                  <th style={th}>Period</th>
                  {days.map((d) => (
                    <th key={d} style={th}>
                      {DAY_NAMES[d - 1] ?? `Day ${d}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p}>
                    <td
                      style={{
                        ...td,
                        fontWeight: 700,
                        color: colors.primary,
                        background: colors.primaryGhost,
                        textAlign: "center",
                        minWidth: 56,
                        fontSize: 14,
                      }}
                    >
                      {p}
                    </td>
                    {days.map((d) => {
                      const slot = cell(d, p);
                      const tint = slot ? subjectTint(slot.subject.name) : null;
                      return (
                        <td
                          key={d}
                          style={{ ...td, background: tint ? tint.bg : "transparent" }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = tint ? tint.hover : "#F8FAFD";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = tint ? tint.bg : "transparent";
                          }}
                        >
                          {slot ? (
                            <>
                              <div style={{ fontWeight: 600, color: colors.ink, letterSpacing: "-0.01em" }}>
                                {slot.subject.name}
                              </div>
                              <div style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                                {slot.teacher.name} · {slot.section.className} {slot.section.name}
                              </div>
                            </>
                          ) : (
                            <span style={{ color: "#CBD5E1" }}>—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<CalendarDays size={22} aria-hidden="true" />}
          title="No slots to show yet"
          detail="Pick a section or load your board to see the week."
        />
      )}
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
