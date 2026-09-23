// Bounded in-memory LRU with per-entry TTL (spec §12.3, RULES.md §8).
// Deliberately dependency-free: this is ~40 lines on a Map (insertion
// order = recency when re-inserted on every hit), and a new npm package
// would add audit surface for zero benefit at this scale. No Redis until
// a shared cache actually becomes a bottleneck — also per §12.3.
//
// Single-process semantics: entries live and die with this Node process.
// Render cold-starts wipe it, which is safe (never correctness, only speed)
// because every get() computes through on miss and writes invalidate.
export interface LruOptions {
  // Max entries; the least-recently-used entry is evicted past this.
  maxEntries: number;
  // Milliseconds an entry stays fresh. Expired entries behave as misses
  // (lazy expiry on access — no background timers, no dangling handles).
  ttlMs: number;
  // Clock, injectable so TTL edge cases are unit-testable without sleeping.
  now?: () => number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class LruCache<V> {
  private readonly store = new Map<string, Entry<V>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: LruOptions) {
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new Error("LruCache maxEntries must be a positive integer.");
    }
    if (!Number.isFinite(options.ttlMs) || options.ttlMs < 0) {
      throw new Error("LruCache ttlMs must be a non-negative number.");
    }
    this.maxEntries = options.maxEntries;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency: re-insert so iteration order stays LRU.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next();
      if (oldest.done) {
        break;
      }
      this.store.delete(oldest.value);
    }
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  // Drop every key starting with `prefix` — the invalidation shape (§12.3):
  // a write in school S drops S's day/month KPI variants without touching
  // other schools' entries.
  deletePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
