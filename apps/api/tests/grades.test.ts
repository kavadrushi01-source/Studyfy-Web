import { describe, expect, it } from "vitest";
import { MinHeap, gradeLetter, percentOf, rankAll, roundPercent, topK } from "../src/lib/grades.js";

describe("grade math (§11)", () => {
  it("rounds percentages to 1 decimal before grading (no mismatched pairs)", () => {
    expect(percentOf(2, 3)).toBe(66.7);
    expect(roundPercent(94.95)).toBe(95);
    expect(gradeLetter(roundPercent(94.95))).toBe("A+");
  });

  it("maps grade boundaries exactly", () => {
    expect(gradeLetter(95)).toBe("A+");
    expect(gradeLetter(94.9)).toBe("A");
    expect(gradeLetter(90)).toBe("A");
    expect(gradeLetter(89.9)).toBe("B+");
    expect(gradeLetter(70)).toBe("C");
    expect(gradeLetter(60)).toBe("D");
    expect(gradeLetter(59.9)).toBe("F");
    expect(gradeLetter(0)).toBe("F");
    expect(percentOf(5, 0)).toBe(0);
  });

  it("ranks with competition order (1224) on ties", () => {
    const ranks = rankAll([
      { studentId: "a", total: 90 },
      { studentId: "b", total: 80 },
      { studentId: "c", total: 80 },
      { studentId: "d", total: 70 },
    ]);
    expect(ranks.get("a")).toBe(1);
    expect(ranks.get("b")).toBe(2);
    expect(ranks.get("c")).toBe(2);
    expect(ranks.get("d")).toBe(4);
  });

  it("heap top-K matches a full sort prefix, ties included", () => {
    const entries = [
      { studentId: "a", total: 95 },
      { studentId: "b", total: 80 },
      { studentId: "c", total: 90 },
      { studentId: "d", total: 80 },
      { studentId: "e", total: 70 },
    ];
    // K=2 cutoff is 90 — no tie at the boundary.
    expect(topK(entries, 2)).toEqual(["a", "c"]);
    // K=3 cutoff is 80, tied with d — both included (fair cut).
    expect(topK(entries, 3)).toEqual(["a", "c", "b", "d"]);
    expect(topK(entries, 0)).toEqual([]);
    expect(topK(entries, 99)).toEqual(["a", "c", "b", "d", "e"]);
  });

  it("min-heap pops ascending", () => {
    const heap = new MinHeap<number>((a, b) => a < b);
    for (const n of [5, 3, 8, 1, 4]) {
      heap.push(n);
    }
    const out: number[] = [];
    while (heap.size > 0) {
      const next = heap.pop();
      if (next !== undefined) {
        out.push(next);
      }
    }
    expect(out).toEqual([1, 3, 4, 5, 8]);
  });
});
