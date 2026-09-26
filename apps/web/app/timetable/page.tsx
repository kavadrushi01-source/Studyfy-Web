"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { EmptyState, SkeletonBlocks } from "../../components/ui/shell";
import { isFailure } from "../../lib/api";
import { useAuth } from "@/lib/auth-context";

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

  const page: React.CSSProperties = {
    maxWidth: 1120,
    margin: "0 auto",
    padding: 28,
    fontFamily: "Inter, system-ui, sans-serif",
    background: "#F8FAFC",
    minHeight: "100vh",
  };
  const input: React.CSSProperties = {
    display: "block",
    width: "100%",
    margin: "4px 0 12px",
    padding: 10,
    borderRadius: 10,
    border: "1px solid #CBD5E1",
  };
  const primaryBtn: React.CSSProperties = {
    background: "#2563EB",
    color: "#fff",
    border: 0,
    borderRadius: 10,
    padding: "10px 16px",
    fontWeight: 600,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };
  const quietBtn: React.CSSProperties = {
    background: "#fff",
    color: "#334155",
    border: "1px solid #E2E8F0",
    borderRadius: 10,
    padding: "10px 16px",
    fontWeight: 500,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };
  const lensBtn = (active: boolean): React.CSSProperties => ({
    ...quietBtn,
    borderColor: active ? "#2563EB" : "#E2E8F0",
    color: active ? "#2563EB" : "#334155",
    background: active ? "#EFF6FF" : "#fff",
    fontWeight: active ? 600 : 500,
  });
  const th: React.CSSProperties = {
    padding: "10px 12px",
    color: "#2563EB",
    fontSize: 13,
    borderBottom: "1px solid #E2E8F0",
  };
  const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13, border: "1px solid #F1F5F9", minWidth: 120 };

  if (!ready) {
    return (
      <main style={page}>
        <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
          <CalendarDays size={22} aria-hidden="true" color="#2563EB" /> Timetable
        </h1>
        <SkeletonBlocks rows={3} height={48} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={page}>
        <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
          <CalendarDays size={22} aria-hidden="true" color="#2563EB" /> Timetable
        </h1>
        <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(15,23,42,.08)", padding: 20 }}>
          <p style={{ color: "#334155" }}>Please sign in to view the timetable.</p>
          <Link href="/login" style={{ color: "#2563EB", fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={page}>
      <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
        <CalendarDays size={22} aria-hidden="true" color="#2563EB" /> Timetable
      </h1>
      <p style={{ color: "#64748B", margin: "0 0 20px", fontSize: 14 }}>
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
            style={{ flex: 1, minWidth: 220, padding: 10, borderRadius: 10, border: "1px solid #CBD5E1" }}
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
            <label style={{ flex: 1, minWidth: 220 }}>
              My staff ID (dev-only)
              <input
                style={{ ...input, marginBottom: 4 }}
                placeholder="Paste staff ID for now"
                value={teacherId}
                onChange={(e) => setTeacherId(e.target.value)}
                aria-label="My staff ID"
              />
            </label>
            <button type="submit" style={{ ...quietBtn, alignSelf: "flex-end", marginBottom: 4 }}>
              Show mine
            </button>
          </div>
          <small style={{ color: "#64748B" }}>
            Login will resolve your identity automatically later — pasting an ID is a dev stopgap only.
          </small>
        </form>
      )}
      {loading ? (
        <SkeletonBlocks rows={3} height={48} />
      ) : slots.length > 0 ? (
        <div
          className="sf-table-scroll"
          style={{ background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(15,23,42,.08)" }}
        >
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
                  <td style={{ ...td, fontWeight: 700, color: "#2563EB" }}>{p}</td>
                  {days.map((d) => {
                    const slot = cell(d, p);
                    return (
                      <td key={d} style={td}>
                        {slot ? (
                          <>
                            <div style={{ fontWeight: 600 }}>{slot.subject.name}</div>
                            <div style={{ color: "#64748B", fontSize: 12 }}>
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
      ) : (
        <EmptyState
          icon={<CalendarDays size={22} aria-hidden="true" />}
          title="No slots to show yet"
          detail="Pick a section or load your board to see the week."
        />
      )}
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
