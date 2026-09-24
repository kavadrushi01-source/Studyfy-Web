"use client";

import { useCallback, useState, type FormEvent } from "react";
import { isFailure } from "../../lib/api";

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
// TIMETABLE (a teacher's own slots — the API forces teacherId to self).
// Grid cells show subject + teacher; empty cells stay blank, unresolved
// demand from generation simply has no cell (never a crash).
// Same token-paste dev workflow as the other pre-dashboard screens.
export default function TimetablePage() {
  const [schoolId, setSchoolId] = useState("");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState<"section" | "teacher">("section");
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [slots, setSlots] = useState<BoardSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const auth = { Authorization: `Bearer ${token}` };

  const loadSections = useCallback(async () => {
    const response = await fetch(`${api}/api/v1/schools/${schoolId}/sections`, { headers: auth });
    const body = (await response.json()) as { data: { sections: SectionOption[] } } | ApiError;
    if (isFailure(response, body)) {
      throw new Error(body.error?.message ?? "Failed to load sections.");
    }
    return body.data.sections;
  }, [api, schoolId, token]);

  const loadBoard = useCallback(
    async (params: URLSearchParams) => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${api}/api/v1/schools/${schoolId}/timetable?${params}`, { headers: auth });
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
    [api, schoolId, token],
  );

  async function connect(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    try {
      setSections(await loadSections());
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

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

  const input = { display: "block", width: "100%", margin: "4px 0 12px", padding: 8 } as const;
  const th: React.CSSProperties = {
    padding: "10px 12px",
    color: "#2563EB",
    fontSize: 13,
    borderBottom: "1px solid #E2E8F0",
  };
  const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13, border: "1px solid #F1F5F9", minWidth: 120 };

  return (
    <main style={{ maxWidth: 1000, margin: "32px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>Timetable</h1>
      {!connected ? (
        <form onSubmit={connect}>
          <label>
            School ID
            <input style={input} value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required />
          </label>
          <label>
            Bearer token (dev only — login screen replaces this)
            <input style={input} value={token} onChange={(e) => setToken(e.target.value)} required />
          </label>
          <button type="submit">Connect</button>
        </form>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }} role="group" aria-label="Board lens">
            <button type="button" onClick={() => setMode("section")} disabled={mode === "section"}>
              Section board
            </button>
            <button type="button" onClick={() => setMode("teacher")} disabled={mode === "teacher"}>
              My timetable
            </button>
          </div>
          {mode === "section" ? (
            <form onSubmit={showSection} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <select
                style={{ flex: 1, padding: 8 }}
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
              <button type="submit">Show</button>
            </form>
          ) : (
            <form onSubmit={showMine} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                style={{ flex: 1, padding: 8 }}
                placeholder="My staff ID (dev only — login resolves this later)"
                value={teacherId}
                onChange={(e) => setTeacherId(e.target.value)}
                aria-label="My staff ID"
              />
              <button type="submit">Show mine</button>
            </form>
          )}
          {loading ? (
            <div>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ height: 48, borderRadius: 14, background: "#F1F5F9", marginBottom: 8 }} />
              ))}
            </div>
          ) : slots.length > 0 ? (
            <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(15,23,42,.08)", overflowX: "auto" }}>
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
            <p style={{ color: "#64748B" }}>No slots to show yet — pick a section or load your board.</p>
          )}
        </>
      )}
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
