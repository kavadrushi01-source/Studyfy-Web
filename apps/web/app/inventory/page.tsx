"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Package } from "lucide-react";
import { EmptyState, SkeletonBlocks, UpgradeLocked } from "../../components/ui/shell";
import { isFailure, upgradeLockedMessage } from "../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, h2Style, labelStyle, mutedStyle, pageFrame, pill, primaryBtn } from "@/lib/theme";

interface StockItem {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  unit: string;
  quantity: number;
  reorderLevel: number;
  lowStock: boolean;
}

interface Movement {
  id: string;
  type: string;
  quantity: number;
  reason: string | null;
  createdAt: string;
  creatorName: string;
}

interface ApiError {
  error: { code: string; message: string };
}

// Inventory (§7 Phase 3 #22): office stock with movement-only counters.
// Admins manage; teachers/accountants read. Quantities change only via
// stock in/out rows — the page never edits a number directly, matching
// the API's movement-only contract.
export default function InventoryPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const canManage = user?.role === "SCHOOL_ADMIN";
  const canView =
    user?.role === "SCHOOL_ADMIN" || user?.role === "TEACHER" || user?.role === "ACCOUNTANT";
  const [items, setItems] = useState<StockItem[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Plan-gate locked state (§16.1): a 403 PLAN_UPGRADE_REQUIRED on the main
  // load parks the server's upgrade message here and the page renders the
  // locked card instead of content or a bare error.
  const [locked, setLocked] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [itemCategory, setItemCategory] = useState("General");
  const [unit, setUnit] = useState("pcs");
  const [reorder, setReorder] = useState("5");
  const [adding, setAdding] = useState(false);
  const [moveQty, setMoveQty] = useState<Record<string, string>>({});
  const [moveReason, setMoveReason] = useState<Record<string, string>>({});
  const [movingId, setMovingId] = useState("");
  const [historyId, setHistoryId] = useState("");
  const [history, setHistory] = useState<Movement[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = useCallback(
    async (opts: { search: string; category: string; lowOnly: boolean }) => {
      if (!schoolId) {
        return;
      }
      setLoading(true);
      setError("");
      setLocked(null);
      try {
        const params = new URLSearchParams();
        if (opts.search) {
          params.set("search", opts.search);
        }
        if (opts.category) {
          params.set("category", opts.category);
        }
        if (opts.lowOnly) {
          params.set("lowStock", "true");
        }
        const query = params.toString();
        const response = await apiFetch(`/api/v1/schools/${schoolId}/inventory/items${query ? `?${query}` : ""}`);
        const body = (await response.json()) as { data: { items: StockItem[] } } | ApiError;
        const upgrade = upgradeLockedMessage(body);
        if (upgrade) {
          setLocked(upgrade);
          return;
        }
        if (isFailure(response, body)) {
          throw new Error(body.error?.message ?? "Failed to load stock.");
        }
        setItems(body.data.items);
      } catch (err) {
        setItems([]);
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setLoading(false);
      }
    },
    [schoolId, apiFetch],
  );

  useEffect(() => {
    if (!ready || !token || !schoolId || !canView) {
      return;
    }
    void load({ search: "", category: "", lowOnly: false });
  }, [ready, token, schoolId, apiFetch, canView, load]);

  const refresh = (): Promise<void> => load({ search, category, lowOnly });

  async function addItem(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId) {
      return;
    }
    setAdding(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/inventory/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          sku: sku.trim() || undefined,
          category: itemCategory.trim() || "General",
          unit: unit.trim() || "pcs",
          reorderLevel: Number(reorder) || 0,
        }),
      });
      const body = (await response.json()) as { data?: unknown } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Add failed.");
      }
      setName("");
      setSku("");
      setNotice("Item added to stock.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setAdding(false);
    }
  }

  async function move(itemId: string, type: "IN" | "OUT"): Promise<void> {
    if (!schoolId) {
      return;
    }
    const qty = Number(moveQty[itemId] ?? "");
    if (!Number.isInteger(qty) || qty < 1) {
      setError("Enter a whole quantity of at least 1.");
      return;
    }
    setMovingId(itemId);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/inventory/items/${itemId}/movements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, quantity: qty, reason: (moveReason[itemId] ?? "").trim() || undefined }),
      });
      const body = (await response.json()) as { data?: unknown } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Stock move failed.");
      }
      setMoveQty((prev) => ({ ...prev, [itemId]: "" }));
      setNotice(type === "IN" ? "Stocked in." : "Stocked out.");
      await refresh();
      if (historyId === itemId) {
        await openHistory(itemId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setMovingId("");
    }
  }

  async function openHistory(itemId: string): Promise<void> {
    if (!schoolId) {
      return;
    }
    setHistoryId(itemId);
    setHistoryLoading(true);
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/inventory/items/${itemId}/movements`);
      const body = (await response.json()) as { data: { movements: Movement[] } } | ApiError;
      if (!isFailure(response, body)) {
        setHistory(body.data.movements);
      }
    } catch {
      // History is a convenience panel — the table above is the record.
    } finally {
      setHistoryLoading(false);
    }
  }

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Inventory</h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Inventory</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: "0 0 8px" }}>Please sign in to view stock.</p>
          <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  if (locked) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Inventory</h1>
        <UpgradeLocked message={locked} />
      </main>
    );
  }

  if (!canView) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Inventory</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: 0 }}>
            Stock lives with the office — your boards carry your own figures.
          </p>
        </div>
      </main>
    );
  }

  const categories = [...new Set(items.map((i) => i.category))].sort();

  return (
    <main style={pageFrame}>
      <h1 style={h1Style}>Inventory</h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        School stock — quantities move only through stock in/out rows, never by editing a number.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void refresh();
        }}
        className="sf-row-wrap"
        style={{ alignItems: "flex-end", marginBottom: 12 }}
      >
        <label style={{ ...labelStyle, flex: 1, minWidth: 200 }}>
          Search
          <input
            className="sf-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or SKU"
            aria-label="Search stock"
          />
        </label>
        <label style={labelStyle}>
          Category
          <select
            className="sf-select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Category filter"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={(e) => setLowOnly(e.target.checked)}
            aria-label="Low stock only"
          />
          Low stock only
        </label>
        <button type="submit" disabled={loading} style={{ ...primaryBtn, opacity: loading ? 0.6 : 1 }}>
          {loading ? "Loading…" : "Apply"}
        </button>
      </form>

      {canManage ? (
        <section className="sf-card" style={{ padding: 20, marginBottom: 16 }}>
          <h2 style={h2Style}>Add item</h2>
          <form onSubmit={addItem} className="sf-row-wrap" style={{ alignItems: "flex-end" }}>
            <label style={{ ...labelStyle, flex: 2, minWidth: 200 }}>
              Name
              <input
                className="sf-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                aria-label="Item name"
                placeholder="Chalk box"
              />
            </label>
            <label style={{ ...labelStyle, flex: 1, minWidth: 120 }}>
              SKU (optional)
              <input
                className="sf-input"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                aria-label="Item SKU"
              />
            </label>
            <label style={{ ...labelStyle, flex: 1, minWidth: 120 }}>
              Category
              <input
                className="sf-input"
                value={itemCategory}
                onChange={(e) => setItemCategory(e.target.value)}
                aria-label="Item category"
              />
            </label>
            <label style={{ ...labelStyle, flex: 1, minWidth: 90 }}>
              Unit
              <input className="sf-input" value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Item unit" />
            </label>
            <label style={{ ...labelStyle, flex: 1, minWidth: 90 }}>
              Reorder at
              <input
                className="sf-input"
                value={reorder}
                onChange={(e) => setReorder(e.target.value)}
                inputMode="numeric"
                aria-label="Reorder level"
              />
            </label>
            <button type="submit" disabled={adding} style={{ ...primaryBtn, opacity: adding ? 0.6 : 1 }}>
              {adding ? "Adding…" : "Add item"}
            </button>
          </form>
        </section>
      ) : null}

      {loading ? (
        <SkeletonBlocks rows={4} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Package size={22} aria-hidden="true" />}
          title="No stock rows match"
          detail="Add the first item above, or clear the filters."
        />
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
          {items.map((item) => (
            <li key={item.id} className="sf-card" style={{ padding: 16 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ color: colors.ink, fontSize: 15, flex: 1 }}>{item.name}</strong>
                <span style={pill(colors.inkSoft, colors.primaryGhost)}>
                  {item.quantity} {item.unit}
                </span>
                {item.lowStock ? (
                  <span style={pill(colors.warning, colors.warningTint)}>Low stock — reorder at {item.reorderLevel}</span>
                ) : null}
              </div>
              <p style={{ ...mutedStyle, fontSize: 13, margin: "6px 0 0" }}>
                {item.category}
                {item.sku ? ` · SKU ${item.sku}` : ""}
              </p>
              {canManage ? (
                <div className="sf-row-wrap" style={{ marginTop: 10, alignItems: "flex-end" }}>
                  <label style={labelStyle}>
                    Qty
                    <input
                      className="sf-input"
                      style={{ width: 90 }}
                      value={moveQty[item.id] ?? ""}
                      onChange={(e) => setMoveQty((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      inputMode="numeric"
                      aria-label={`Quantity for ${item.name}`}
                    />
                  </label>
                  <label style={{ ...labelStyle, flex: 1, minWidth: 160 }}>
                    Reason (optional)
                    <input
                      className="sf-input"
                      value={moveReason[item.id] ?? ""}
                      onChange={(e) => setMoveReason((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      aria-label={`Reason for ${item.name}`}
                      placeholder="Term purchase / class issue…"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void move(item.id, "IN")}
                    disabled={movingId === item.id}
                    className="sf-btn"
                  >
                    Stock in
                  </button>
                  <button
                    type="button"
                    onClick={() => void move(item.id, "OUT")}
                    disabled={movingId === item.id}
                    className="sf-btn"
                  >
                    Stock out
                  </button>
                  <button type="button" onClick={() => void openHistory(item.id)} className="sf-btn">
                    History
                  </button>
                </div>
              ) : null}
              {historyId === item.id ? (
                <div style={{ marginTop: 10, borderTop: "1px solid #F1F5F9", paddingTop: 10 }}>
                  {historyLoading ? (
                    <SkeletonBlocks rows={2} />
                  ) : history.length === 0 ? (
                    <p style={{ ...mutedStyle, fontSize: 13, margin: 0 }}>No movements yet.</p>
                  ) : (
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
                      {history.map((m) => (
                        <li key={m.id} style={{ fontSize: 13, color: colors.inkSoft }}>
                          <strong style={{ color: m.type === "IN" ? colors.success : colors.danger }}>
                            {m.type} {m.quantity}
                          </strong>{" "}
                          {m.reason ? `— ${m.reason} ` : ""}· {m.creatorName} ·{" "}
                          {new Date(m.createdAt).toLocaleString("en-GB")}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {notice ? <p style={{ color: colors.success, fontSize: 14, margin: "12px 0 0" }}>{notice}</p> : null}
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
