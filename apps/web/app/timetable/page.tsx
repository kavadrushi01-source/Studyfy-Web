"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { EmptyState, SkeletonBlocks } from "../../components/ui/shell";
import { isFailure } from "../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, labelStyle, mutedStyle, pageFrame, primaryBtn, secondaryBtn } from "@/lib/theme";

interface BoardSlot {
  id: string;
  dayOfWeek: number;
  period: number;
  subject: { id: string; name: string };
  teacher: { id: string; name: string };
  section: { id: string; name: string; className: string };
}

interface SectionOption {
  id: string;
  name: string;
  class: { name: string };
}

interface StaffOption {
  id: string;
  designation: string | null;
  user: { id: string; name: string; email: string; role: { name: string } };
}

interface SubjectOption {
  id: string;
  name: string;
}

interface ApiError {
  error: { code: string; message: string };
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Timetable board (§7 Phase 1 #5) + admin build tools. Lenses per role:
// pupils/parents/accountants see the SECTION board pinned to their scope;
// teachers get section + MY TIMETABLE (resolved from the login, no pasting);
// admins additionally open any teacher's board via the staff picker and get
// the build block below (auto-generate per section, manual slot, per-cell
// remove). Grid cells show subject + teacher; empty cells stay blank.
// Identity comes from the shared session (useAuth).
export default function TimetablePage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const isAdmin = user?.role === "SCHOOL_ADMIN";
  const isTeacher = user?.role === "TEACHER";
  const [mode, setMode] = useState<"section" | "teacher">("section");
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [teacherId, setTeacherId] = useState("");
  const [slots, setSlots] = useState<BoardSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  // Admin build state.
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [genSection, setGenSection] = useState("");
  const [genPeriods, setGenPeriods] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState("");
  const [slotSection, setSlotSection] = useState("");
  const [slotSubject, setSlotSubject] = useState("");
  const [slotTeacher, setSlotTeacher] = useState("");
  const [slotDay, setSlotDay] = useState("1");
  const [slotPeriod, setSlotPeriod] = useState("1");
  const [adding, setAdding] = useState(false);

  const loadSections = useCallback(async () => {
    if (!schoolId) {
      throw new Error("Please sign in to view the timetable.");
    }
    // Staff hold sections.read and get the full list; pupils/parents don't,
    // so they go straight to the board-scope endpoint (their pinned
    // sections, same shape) instead of burning a 403 probe every visit.
    if (user?.role === "SCHOOL_ADMIN" || user?.role === "TEACHER") {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/sections`);
      const body = (await response.json()) as { data: { sections: SectionOption[] } } | ApiError;
      if (!isFailure(response, body)) {
        return body.data.sections;
      }
    }
    const scoped = await apiFetch(`/api/v1/schools/${schoolId}/timetable/sections`);
    const scopedBody = (await scoped.json()) as { data: { sections: SectionOption[] } } | ApiError;
    if (isFailure(scoped, scopedBody)) {
      throw new Error(scopedBody.error?.message ?? "Failed to load sections.");
    }
    return scopedBody.data.sections;
  }, [schoolId, apiFetch, user?.role]);

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
        if (isAdmin) {
          const [staffRes, subjRes] = await Promise.all([
            apiFetch(`/api/v1/schools/${schoolId}/staff`),
            apiFetch(`/api/v1/schools/${schoolId}/subjects`),
          ]);
          const staffBody = (await staffRes.json()) as { data: { staff: StaffOption[] } } | ApiError;
          if (!isFailure(staffRes, staffBody)) {
            setStaffList(staffBody.data.staff.filter((s) => s.user.role.name === "TEACHER"));
          }
          const subjBody = (await subjRes.json()) as { data: { subjects: SubjectOption[] } } | ApiError;
          if (!isFailure(subjRes, subjBody)) {
            setSubjects(subjBody.data.subjects);
            // Seed the per-subject defaults INTO state: the inputs display
            // 5 when untouched, and submit must see the same 5 (a displayed
            // default that submits as 0 once generated empty weeks).
            setGenPeriods((prev) => {
              const next = { ...prev };
              for (const s of subjBody.data.subjects) {
                if (next[s.id] === undefined) {
                  next[s.id] = "5";
                }
              }
              return next;
            });
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      }
    })();
  }, [ready, token, schoolId, loadSections, apiFetch, isAdmin]);

  function showSection(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (sectionId) {
      const q = new URLSearchParams({ sectionId }).toString();
      setLastQuery(q);
      void loadBoard(new URLSearchParams({ sectionId }));
    }
  }

  // Teacher's own week — identity comes from the login, nothing to paste.
  function showMine(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const q = new URLSearchParams({ mine: "true" }).toString();
    setLastQuery(q);
    void loadBoard(new URLSearchParams({ mine: "true" }));
  }

  // Admin oversight: any teacher's week via the staff picker.
  function showTeacher(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (teacherId) {
      const q = new URLSearchParams({ teacherId }).toString();
      setLastQuery(q);
      void loadBoard(new URLSearchParams({ teacherId }));
    }
  }

  async function reloadBoard(): Promise<void> {
    if (lastQuery) {
      await loadBoard(new URLSearchParams(lastQuery));
    }
  }

  // Admin: auto-generate a section's week from per-subject periods.
  async function generateBoard(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId || !genSection) {
      return;
    }
    const demands = subjects
      .map((s) => ({ sectionId: genSection, subjectId: s.id, periodsPerWeek: Number(genPeriods[s.id] ?? 0) }))
      .filter((d) => Number.isInteger(d.periodsPerWeek) && d.periodsPerWeek > 0);
    if (demands.length === 0) {
      setError("Set at least one subject's periods per week above zero.");
      return;
    }
    setGenerating(true);
    setError("");
    setGenResult("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/timetable/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demands, days: [1, 2, 3, 4, 5], periodsPerDay: 6 }),
      });
      const body = (await response.json()) as {
        data: { placed: unknown[]; unresolved: { subjectName?: string; reason?: string }[] };
      } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Generation failed.");
      }
      const placed = body.data.placed.length;
      const missing = body.data.unresolved;
      setGenResult(
        missing.length === 0
          ? `Placed ${placed} lessons — full week built.`
          : `Placed ${placed} lessons — ${missing.length} period(s) unplaced: ${missing
              .map((u) => u.subjectName ?? u.reason ?? "unknown")
              .slice(0, 4)
              .join(", ")}${missing.length > 4 ? "…" : ""}`,
      );
      setSectionId(genSection);
      const q = new URLSearchParams({ sectionId: genSection }).toString();
      setLastQuery(q);
      await loadBoard(new URLSearchParams({ sectionId: genSection }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setGenerating(false);
    }
  }

  // Admin: place one manual slot (qualification + conflicts checked API-side).
  async function addSlot(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId || !slotSection || !slotSubject || !slotTeacher) {
      return;
    }
    setAdding(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/timetable/slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId: slotSection,
          subjectId: slotSubject,
          teacherId: slotTeacher,
          dayOfWeek: Number(slotDay),
          period: Number(slotPeriod),
        }),
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not place the slot.");
      }
      setNotice("Slot placed.");
      await reloadBoard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setAdding(false);
    }
  }

  // Admin: remove one slot, then refresh the same board.
  async function removeSlot(slotId: string): Promise<void> {
    if (!schoolId) {
      return;
    }
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/timetable/slots/${slotId}`, {
        method: "DELETE",
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not remove the slot.");
      }
      setNotice("Slot removed.");
      await reloadBoard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
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
        {isTeacher
          ? "Section board for your classes — flip the lens for your own teaching week."
          : "Pick a section to see its week."}
      </p>
      {(isTeacher || isAdmin) && (
        <div className="sf-row-wrap" style={{ marginBottom: 12 }} role="group" aria-label="Board lens">
          <button type="button" onClick={() => setMode("section")} style={lensBtn(mode === "section")}>
            Section board
          </button>
          <button type="button" onClick={() => setMode("teacher")} style={lensBtn(mode === "teacher")}>
            {isTeacher ? "My timetable" : "Teacher board"}
          </button>
        </div>
      )}
      {mode === "section" || (!isTeacher && !isAdmin) ? (
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
      ) : isTeacher ? (
        <form onSubmit={showMine} className="sf-row-wrap" style={{ marginBottom: 12 }}>
          <p style={{ ...mutedStyle, margin: 0, flex: 1, minWidth: 220 }}>
            Signed in as {user?.name ?? "teacher"} — loads your own teaching week.
          </p>
          <button type="submit" style={primaryBtn}>
            Show my timetable
          </button>
        </form>
      ) : (
        <form onSubmit={showTeacher} className="sf-row-wrap" style={{ marginBottom: 12 }}>
          <select
            className="sf-select"
            style={{ flex: 1, minWidth: 220 }}
            value={teacherId}
            onChange={(e) => setTeacherId(e.target.value)}
            aria-label="Teacher"
          >
            <option value="">— pick a teacher —</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.user.name}
              </option>
            ))}
          </select>
          <button type="submit" style={primaryBtn}>
            Show
          </button>
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
                              {isAdmin ? (
                                <button
                                  type="button"
                                  onClick={() => void removeSlot(slot.id)}
                                  aria-label={`Remove ${slot.subject.name} period ${p}`}
                                  style={{
                                    marginTop: 6,
                                    padding: "3px 10px",
                                    fontSize: 12,
                                    borderRadius: 8,
                                    border: `1px solid ${colors.line}`,
                                    background: "#fff",
                                    color: colors.danger,
                                    cursor: "pointer",
                                  }}
                                >
                                  Remove
                                </button>
                              ) : null}
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
      {notice ? (
        <p style={{ color: colors.success, fontSize: 14, margin: "12px 0 0" }}>{notice}</p>
      ) : null}
      {isAdmin ? (
        <section className="sf-card" style={{ marginTop: 20, padding: 20 }}>
          <h2 style={{ ...h1Style, fontSize: 18, margin: "0 0 4px" }}>Build timetable (admin)</h2>
          <p style={{ ...mutedStyle, fontSize: 13, margin: "0 0 16px" }}>
            Auto-generate a section&apos;s week, or place one period by hand. Conflicts and unqualified
            teachers are refused by the server.
          </p>
          <form onSubmit={generateBoard} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ ...labelStyle, maxWidth: 320 }}>
              Section to build
              <select
                className="sf-select"
                value={genSection}
                onChange={(e) => setGenSection(e.target.value)}
                aria-label="Section to build"
              >
                <option value="">— pick a section —</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.class.name} · {s.name}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: "grid", gap: 8 }}>
              {subjects.map((s) => (
                <label
                  key={s.id}
                  style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: colors.inkSoft }}
                >
                  <span style={{ flex: 1 }}>{s.name} — periods per week</span>
                  <input
                    className="sf-input"
                    style={{ width: 90 }}
                    inputMode="numeric"
                    value={genPeriods[s.id] ?? "5"}
                    onChange={(e) => setGenPeriods((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    aria-label={`${s.name} periods per week`}
                  />
                </label>
              ))}
            </div>
            <div>
              <button type="submit" disabled={generating || !genSection} style={{ ...primaryBtn, opacity: generating ? 0.6 : 1 }}>
                {generating ? "Building…" : "Auto-build week (Mon–Fri, 6 periods)"}
              </button>
            </div>
            {genResult ? (
              <p style={{ color: colors.success, fontSize: 13, margin: 0 }}>{genResult}</p>
            ) : null}
          </form>
          <form onSubmit={addSlot} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
            <h3 style={{ ...h1Style, fontSize: 15, margin: 0 }}>Place one period by hand</h3>
            <div className="sf-row-wrap">
              <label style={{ ...labelStyle, flex: 1, minWidth: 150 }}>
                Section
                <select
                  className="sf-select"
                  value={slotSection}
                  onChange={(e) => setSlotSection(e.target.value)}
                  aria-label="Slot section"
                >
                  <option value="">—</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.class.name} · {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ ...labelStyle, flex: 1, minWidth: 150 }}>
                Subject
                <select
                  className="sf-select"
                  value={slotSubject}
                  onChange={(e) => setSlotSubject(e.target.value)}
                  aria-label="Slot subject"
                >
                  <option value="">—</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ ...labelStyle, flex: 1, minWidth: 150 }}>
                Teacher
                <select
                  className="sf-select"
                  value={slotTeacher}
                  onChange={(e) => setSlotTeacher(e.target.value)}
                  aria-label="Slot teacher"
                >
                  <option value="">—</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.user.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ ...labelStyle, minWidth: 90 }}>
                Day
                <select
                  className="sf-select"
                  value={slotDay}
                  onChange={(e) => setSlotDay(e.target.value)}
                  aria-label="Slot day"
                >
                  {DAY_NAMES.map((d, i) => (
                    <option key={d} value={String(i + 1)}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ ...labelStyle, minWidth: 90 }}>
                Period
                <select
                  className="sf-select"
                  value={slotPeriod}
                  onChange={(e) => setSlotPeriod(e.target.value)}
                  aria-label="Slot period"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <button type="submit" disabled={adding} style={{ ...secondaryBtn, opacity: adding ? 0.6 : 1 }}>
                {adding ? "Placing…" : "Place slot"}
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </main>
  );
}
