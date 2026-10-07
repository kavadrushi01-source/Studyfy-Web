import { describe, expect, it } from "vitest";
import {
  ABSENCE_RATE_THRESHOLD,
  CONSECUTIVE_ABSENCE_THRESHOLD,
  DEFAULT_WINDOW_DAYS,
  LATE_COUNT_THRESHOLD,
  TREND_DROP_THRESHOLD,
  detectAnomalies,
  type AnomalyDay,
  type AnomalyType,
} from "../src/lib/attendance-anomalies.js";

// Pure sliding-window detection (§11): hand-built day trails, no DB, no AI.
// Each signal gets a positive case, a boundary case, and a just-below case.
function trail(pattern: string): AnomalyDay[] {
  const map: Record<string, AnomalyDay["status"]> = { P: "PRESENT", A: "ABSENT", L: "LATE", E: "EXCUSED" };
  return [...pattern].map((ch, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, "0")}`,
    status: map[ch] ?? "PRESENT",
  }));
}

function typesOf(days: AnomalyDay[], windowDays = DEFAULT_WINDOW_DAYS): AnomalyType[] {
  return detectAnomalies(days, windowDays).map((a) => a.type);
}

describe("detectAnomalies — pure sliding-window detection (no AI)", () => {
  it("flags trailing consecutive absences at the threshold, not below", () => {
    expect(typesOf(trail("PPPPPPPAAA"))).toContain("CONSECUTIVE_ABSENCES");
    expect(typesOf(trail("PPPPPPPPAA"))).not.toContain("CONSECUTIVE_ABSENCES");
    // Stale absences (broken by a later present) are not "consecutive".
    expect(typesOf(trail("PPPAAAPPPP"))).not.toContain("CONSECUTIVE_ABSENCES");
  });

  it("reports the run length and end date as evidence", () => {
    const found = detectAnomalies(trail("PPPPPPAAAA")).find((a) => a.type === "CONSECUTIVE_ABSENCES");
    expect(found?.evidence["consecutiveAbsences"]).toBe(4);
    expect(found?.evidence["asOf"]).toBe("2026-09-10");
    expect(found?.facts).toContain("4 consecutive absences");
  });

  it("flags absence rates at/above 30%, ignoring excused time off", () => {
    expect(typesOf(trail("PPAPAPAPAP"))).toContain("HIGH_ABSENCE_RATE");
    expect(typesOf(trail("PPPPPPPPPA"))).not.toContain("HIGH_ABSENCE_RATE");
    // 4 excused in 10 is authorized, not an anomaly.
    expect(typesOf(trail("PPEPEEPEEP"))).not.toContain("HIGH_ABSENCE_RATE");
  });

  it("flags a 30-point presence drop between window halves", () => {
    // First half 5/5 present, second half 1/5 → drop 0.8.
    expect(typesOf(trail("PPPPPALAAA"))).toContain("DECLINING_TREND");
    // Flat bad attendance is a rate problem, not a trend.
    expect(typesOf(trail("AAPPAA PPAA".replace(/ /g, "")))).not.toContain("DECLINING_TREND");
    // Recovery (bad first half, good second) is not a decline.
    expect(typesOf(trail("AAAPAPPPPP"))).not.toContain("DECLINING_TREND");
  });

  it("flags 3+ lates, not 2", () => {
    expect(typesOf(trail("PPLPLPLPPP"))).toContain("FREQUENT_LATES");
    expect(typesOf(trail("PPLPPLPPPP"))).not.toContain("FREQUENT_LATES");
  });

  it("returns nothing for short trails and clean attendance", () => {
    expect(detectAnomalies(trail("PPAP"))).toEqual([]);
    expect(detectAnomalies(trail("PPPPPPPPPP"))).toEqual([]);
    expect(detectAnomalies([])).toEqual([]);
  });

  it("slides over the trailing window only — ancient history is out of scope", () => {
    const ancient = `AAA${"P".repeat(10)}`;
    expect(typesOf(trail(ancient), 10)).not.toContain("CONSECUTIVE_ABSENCES");
    expect(typesOf(trail(ancient), 10)).not.toContain("HIGH_ABSENCE_RATE");
  });

  it("thresholds are the exported constants (endpoint and tests share them)", () => {
    expect(CONSECUTIVE_ABSENCE_THRESHOLD).toBe(3);
    expect(ABSENCE_RATE_THRESHOLD).toBe(0.3);
    expect(TREND_DROP_THRESHOLD).toBe(0.3);
    expect(LATE_COUNT_THRESHOLD).toBe(3);
    expect(DEFAULT_WINDOW_DAYS).toBe(10);
  });
});
