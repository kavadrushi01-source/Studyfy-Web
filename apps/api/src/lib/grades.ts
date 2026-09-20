// Grade + rank math (§11 DSA row). Pure functions — unit-tested directly,
// reused by the results endpoint. Two consistency rules worth stating:
// 1. Every percentage is rounded to 1 decimal FIRST (roundHalfUp), and the
//    grade letter is computed FROM the rounded value — so 94.95% displays
//    as 95.0% AND grades A+, never a mismatched pair.
// 2. Ranks are competition ranking ("1224"): tied totals share a rank, and
//    the next rank skips. Top-K displays keep TRUE ranks (computed over the
//    whole class, then sliced) — never re-ranked within the slice.

export function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

export function percentOf(obtained: number, max: number): number {
  if (max <= 0) {
    return 0;
  }
  return roundPercent((obtained / max) * 100);
}

export type GradeLetter = "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F";

export function gradeLetter(percent: number): GradeLetter {
  if (percent >= 95) {
    return "A+";
  }
  if (percent >= 90) {
    return "A";
  }
  if (percent >= 85) {
    return "B+";
  }
  if (percent >= 80) {
    return "B";
  }
  if (percent >= 75) {
    return "C+";
  }
  if (percent >= 70) {
    return "C";
  }
  if (percent >= 60) {
    return "D";
  }
  return "F";
}

// Generic binary min-heap (§11: heaps/top-K). Kept dependency-free on
// purpose — this file is the DSA demonstration, and a 40-line heap with
// direct unit tests beats an imported one nobody reads.
export class MinHeap<T> {
  private readonly items: T[] = [];

  constructor(private readonly less: (a: T, b: T) => boolean) {}

  get size(): number {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(value: T): void {
    this.items.push(value);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const current = this.items[index];
      const parentValue = this.items[parent];
      if (current === undefined || parentValue === undefined || !this.less(current, parentValue)) {
        break;
      }
      this.items[index] = parentValue;
      this.items[parent] = current;
      index = parent;
    }
  }

  pop(): T | undefined {
    if (this.items.length === 0) {
      return undefined;
    }
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last !== undefined) {
      this.items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = index * 2 + 2;
        let smallest = index;
        const current = this.items[smallest];
        const leftValue = this.items[left];
        const rightValue = this.items[right];
        if (leftValue !== undefined && current !== undefined && this.less(leftValue, current)) {
          smallest = left;
        }
        const smallestValue = this.items[smallest];
        if (rightValue !== undefined && smallestValue !== undefined && this.less(rightValue, smallestValue)) {
          smallest = right;
        }
        if (smallest === index) {
          break;
        }
        const next = this.items[smallest];
        if (current !== undefined && next !== undefined) {
          this.items[smallest] = current;
          this.items[index] = next;
        }
        index = smallest;
      }
    }
    return top;
  }
}

export interface RankedEntry {
  studentId: string;
  total: number;
}

// Competition ranking over totals ("1224"). Full sort — used when the whole
// board is shown. Returns rank per studentId.
export function rankAll(entries: RankedEntry[]): Map<string, number> {
  const ordered = [...entries].sort((a, b) => b.total - a.total);
  const ranks = new Map<string, number>();
  let rank = 0;
  let lastTotal: number | null = null;
  for (let i = 0; i < ordered.length; i += 1) {
    const entry = ordered[i];
    if (!entry) {
      continue;
    }
    if (lastTotal === null || entry.total !== lastTotal) {
      rank = i + 1;
      lastTotal = entry.total;
    }
    ranks.set(entry.studentId, rank);
  }
  return ranks;
}

// Top-K selection in O(n log k) WITHOUT a full sort (§11): stream every
// entry through a size-K min-heap, evicting the smallest. Returns the K
// ids ordered best-first. Ranks themselves still come from rankAll over
// the full set — the heap only picks WHO is shown.
export function topK(entries: RankedEntry[], k: number): string[] {
  if (k <= 0) {
    return [];
  }
  const heap = new MinHeap<RankedEntry>((a, b) => a.total < b.total);
  for (const entry of entries) {
    const smallest = heap.peek();
    if (heap.size < k) {
      heap.push(entry);
    } else if (smallest && entry.total > smallest.total) {
      heap.pop();
      heap.push(entry);
    }
  }
  const winners: RankedEntry[] = [];
  while (heap.size > 0) {
    const next = heap.pop();
    if (next) {
      winners.push(next);
    }
  }
  // Ties at the cutoff: a strict top-K cut can split equal totals across
  // the boundary, which reads as unfair on a leaderboard. Include every
  // entry tied with the Kth score — the SMALLEST held value (first popped
  // in ascending order), not the largest. Still O(n log k) + one pass.
  if (winners.length > 0) {
    const cutoff = winners[0]?.total;
    if (cutoff !== undefined) {
      for (const entry of entries) {
        if (entry.total === cutoff && !winners.some((w) => w.studentId === entry.studentId)) {
          winners.push(entry);
        }
      }
    }
  }
  // Deterministic order: totals descending, studentId ascending as the
  // tiebreak — identical input always renders an identical board.
  return winners
    .sort((a, b) => b.total - a.total || (a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0))
    .map((w) => w.studentId);
}
