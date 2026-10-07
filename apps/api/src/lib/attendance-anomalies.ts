// Attendance anomaly detection (§7 Phase 3 #18, §11 sliding window).
//
// The DETECTION is pure computation — no AI call anywhere in this file.
// A fixed-size window slides over each pupil's trailing marked days and
// four signals are read off it: consecutive absences, high absence rate,
// declining trend (first half vs second half of the window), and frequent
// lates. Groq's only job, at the endpoint layer, is turning a detected
// pattern's facts into a human-readable sentence — it never does the
// detection reasoning itself.
//
// Weights match attendance.service.ts: PRESENT = 1, LATE = 0.5, anything
// else = 0. Absence-rate counting uses ABSENT only — EXCUSED is authorized
// time off, not a warning sign.
export type AnomalyDayStatus = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";

export interface AnomalyDay {
  date: string;
  status: AnomalyDayStatus;
}

export type AnomalyType =
  | "CONSECUTIVE_ABSENCES"
  | "HIGH_ABSENCE_RATE"
  | "DECLINING_TREND"
  | "FREQUENT_LATES";

export interface AttendanceAnomaly {
  type: AnomalyType;
  windowDays: number;
  // Machine-readable evidence (counts, rates, dates) — the endpoint feeds
  // these numbers to Groq as facts, never pupil names.
  evidence: Record<string, number | string>;
  // Pre-written data sentence. Groq rephrases it for humans; nothing about
  // the detection changes if the rephrase fails.
  facts: string;
}

// Tunables, exported so tests and the endpoint share the same numbers.
export const DEFAULT_WINDOW_DAYS = 10;
export const MIN_WINDOW_DAYS = 5;
export const MAX_WINDOW_DAYS = 30;
export const CONSECUTIVE_ABSENCE_THRESHOLD = 3;
export const ABSENCE_RATE_THRESHOLD = 0.3;
export const TREND_HALVES_MIN_DAYS = 3;
export const TREND_DROP_THRESHOLD = 0.3;
export const LATE_COUNT_THRESHOLD = 3;

function weight(status: AnomalyDayStatus): number {
  if (status === "PRESENT") {
    return 1;
  }
  if (status === "LATE") {
    return 0.5;
  }
  return 0;
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

// Trailing run of ABSENT at the END of the window — the freshest signal,
// a pupil currently mid-absence.
function trailingAbsences(window: AnomalyDay[]): { count: number; since: string } {
  let count = 0;
  let since = "";
  for (let i = window.length - 1; i >= 0; i -= 1) {
    const day = window[i];
    if (!day || day.status !== "ABSENT") {
      break;
    }
    count += 1;
    since = day.date;
  }
  return { count, since };
}

function halfRate(days: AnomalyDay[]): number {
  if (days.length === 0) {
    return 0;
  }
  return days.reduce((sum, d) => sum + weight(d.status), 0) / days.length;
}

// days MUST be date-ordered ascending. Returns [] when the trail is too
// short to reason about (fewer than MIN_WINDOW_DAYS marked days).
export function detectAnomalies(days: AnomalyDay[], windowDays: number = DEFAULT_WINDOW_DAYS): AttendanceAnomaly[] {
  const window = days.slice(-windowDays);
  if (window.length < MIN_WINDOW_DAYS) {
    return [];
  }
  const anomalies: AttendanceAnomaly[] = [];
  const lastDate = window[window.length - 1]?.date ?? "";

  const trailing = trailingAbsences(window);
  if (trailing.count >= CONSECUTIVE_ABSENCE_THRESHOLD) {
    anomalies.push({
      type: "CONSECUTIVE_ABSENCES",
      windowDays: window.length,
      evidence: { consecutiveAbsences: trailing.count, since: trailing.since, asOf: lastDate },
      facts: `${trailing.count} consecutive absences ending ${lastDate}`,
    });
  }

  const absentDays = window.filter((d) => d.status === "ABSENT").length;
  const absenceRate = absentDays / window.length;
  if (absenceRate >= ABSENCE_RATE_THRESHOLD) {
    anomalies.push({
      type: "HIGH_ABSENCE_RATE",
      windowDays: window.length,
      evidence: { absentDays, windowDays: window.length, absenceRate: Math.round(absenceRate * 1000) / 1000 },
      facts: `absence rate ${pct(absenceRate)} over the last ${window.length} marked days (${absentDays} of ${window.length})`,
    });
  }

  const half = Math.floor(window.length / 2);
  const first = window.slice(0, half);
  const second = window.slice(half);
  if (first.length >= TREND_HALVES_MIN_DAYS && second.length >= TREND_HALVES_MIN_DAYS) {
    const drop = halfRate(first) - halfRate(second);
    if (drop >= TREND_DROP_THRESHOLD) {
      anomalies.push({
        type: "DECLINING_TREND",
        windowDays: window.length,
        evidence: {
          firstHalfRate: Math.round(halfRate(first) * 1000) / 1000,
          secondHalfRate: Math.round(halfRate(second) * 1000) / 1000,
        },
        facts: `presence fell from ${pct(halfRate(first))} to ${pct(halfRate(second))} between the two halves of the window`,
      });
    }
  }

  const lateDays = window.filter((d) => d.status === "LATE").length;
  if (lateDays >= LATE_COUNT_THRESHOLD) {
    anomalies.push({
      type: "FREQUENT_LATES",
      windowDays: window.length,
      evidence: { lateDays, windowDays: window.length },
      facts: `${lateDays} late arrivals in the last ${window.length} marked days`,
    });
  }

  return anomalies;
}
