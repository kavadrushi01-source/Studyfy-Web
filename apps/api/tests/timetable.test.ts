import { describe, expect, it } from "vitest";
import { generateTimetable } from "../src/lib/timetable.js";

function assertNoConflicts(
  placed: { sectionId: string; teacherId: string; day: number; period: number }[],
): void {
  const sectionSlots = new Set<string>();
  const teacherSlots = new Set<string>();
  for (const slot of placed) {
    const s = `${slot.sectionId}@${slot.day}-${slot.period}`;
    const t = `${slot.teacherId}@${slot.day}-${slot.period}`;
    expect(sectionSlots.has(s), `section double-booked at ${s}`).toBe(false);
    expect(teacherSlots.has(t), `teacher double-booked at ${t}`).toBe(false);
    sectionSlots.add(s);
    teacherSlots.add(t);
  }
}

describe("timetable generator (§10 graph coloring, §11)", () => {
  it("schedules a solvable week with zero conflicts", async () => {
    const result = generateTimetable({
      demands: [
        { sectionId: "9-A", subjectId: "math", periods: 3 },
        { sectionId: "9-A", subjectId: "eng", periods: 2 },
        { sectionId: "9-B", subjectId: "math", periods: 2 },
      ],
      qualifications: [
        { teacherId: "t1", subjectIds: ["math"] },
        { teacherId: "t2", subjectIds: ["math", "eng"] },
      ],
      days: [1, 2, 3, 4, 5],
      periodsPerDay: 6,
    });
    expect(result.unresolved).toEqual([]);
    expect(result.placed).toHaveLength(7);
    assertNoConflicts(result.placed);
    // Every math slot has a math-qualified teacher, every eng slot t2.
    for (const slot of result.placed) {
      if (slot.subjectId === "eng") {
        expect(slot.teacherId).toBe("t2");
      } else {
        expect(["t1", "t2"]).toContain(slot.teacherId);
      }
    }
  });

  it("returns partial + reasons instead of hanging when impossible", () => {
    // One teacher, one slot total, three lessons wanted.
    const result = generateTimetable({
      demands: [{ sectionId: "9-A", subjectId: "math", periods: 3 }],
      qualifications: [{ teacherId: "t1", subjectIds: ["math"] }],
      days: [1],
      periodsPerDay: 1,
    });
    expect(result.placed).toHaveLength(1);
    expect(result.unresolved).toEqual([
      { sectionId: "9-A", subjectId: "math", periodsMissing: 2, reason: "NO_FREE_SLOT" },
    ]);
    assertNoConflicts(result.placed);
  });

  it("flags subjects nobody is qualified to teach", () => {
    const result = generateTimetable({
      demands: [
        { sectionId: "9-A", subjectId: "math", periods: 1 },
        { sectionId: "9-A", subjectId: "latin", periods: 2 },
      ],
      qualifications: [{ teacherId: "t1", subjectIds: ["math"] }],
      days: [1, 2],
      periodsPerDay: 6,
    });
    expect(result.placed).toHaveLength(1);
    expect(result.unresolved).toEqual([
      { sectionId: "9-A", subjectId: "latin", periodsMissing: 2, reason: "NO_QUALIFIED_TEACHER" },
    ]);
  });

  it("is deterministic: identical input, identical output", () => {
    const input = {
      demands: [
        { sectionId: "9-A", subjectId: "math", periods: 4 },
        { sectionId: "9-B", subjectId: "eng", periods: 4 },
      ],
      qualifications: [
        { teacherId: "t1", subjectIds: ["math", "eng"] },
        { teacherId: "t2", subjectIds: ["math", "eng"] },
      ],
      days: [1, 2, 3],
      periodsPerDay: 4,
    };
    expect(generateTimetable(input)).toEqual(generateTimetable(input));
  });
});
