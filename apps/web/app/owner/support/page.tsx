"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LifeBuoy } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { cardStyle, colors, h1Style, mutedStyle, pill, primaryBtn } from "@/lib/theme";
import { isFailure } from "../../../lib/api";
import { EmptyState, Shell, SkeletonBlocks } from "../../../components/ui/shell";

interface OwnerTicketRow {
  id: string;
  schoolId: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  school: { name: string; slug: string };
}

interface OwnerTicketMsg {
  id: string;
  authorId: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
}

interface OwnerTicketDetail extends OwnerTicketRow {
  messages: OwnerTicketMsg[];
}

interface ApiError {
  error: { code: string; message: string };
}

function statusPill(status: string): React.CSSProperties {
  if (status === "OPEN") {
    return pill(colors.warning, colors.warningTint);
  }
  if (status === "IN_PROGRESS") {
    return pill(colors.primary, colors.primaryGhost);
  }
  if (status === "RESOLVED") {
    return pill(colors.success, colors.successTint);
  }
  return pill(colors.muted, colors.lineSoft);
}

// Platform support console (§7 Phase 4 #27): every school's threads with
// internal notes INCLUDED (amber INTERNAL pills — these never render on the
// school side by API construction). Reply visible or internal, move status,
// close. Impersonation (§13.9) stays a later chunk — this console only talks.
export default function OwnerSupportPage() {
  const { token, ready, apiFetch, user } = useAuth();
  const isOwner = user?.role === "PLATFORM_OWNER";
  const [rows, setRows] = useState<OwnerTicketRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [activeId, setActiveId] = useState("");
  const [detail, setDetail] = useState<OwnerTicketDetail | null>(null);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [nextStatus, setNextStatus] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (statusFilter) {
        params.set("status", statusFilter);
      }
      const query = params.toString();
      const response = await apiFetch(`/api/v1/platform/tickets${query ? `?${query}` : ""}`);
      const body = (await response.json()) as { data: { tickets: OwnerTicketRow[] } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Failed to load tickets.");
      }
      setRows(body.data.tickets);
      if (body.data.tickets.length > 0 && !activeId) {
        setActiveId(body.data.tickets[0]?.id ?? "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, statusFilter, activeId]);

  const loadDetail = useCallback(
    async (ticketId: string) => {
      if (!ticketId) {
        return;
      }
      try {
        const response = await apiFetch(`/api/v1/platform/tickets/${ticketId}`);
        const body = (await response.json()) as { data: { ticket: OwnerTicketDetail } } | ApiError;
        if (isFailure(response, body)) {
          throw new Error(body.error?.message ?? "Failed to load the thread.");
        }
        setDetail(body.data.ticket);
        setNextStatus("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      }
    },
    [apiFetch],
  );

  useEffect(() => {
    if (!ready || !token || !isOwner) {
      return;
    }
    void load();
  }, [ready, token, apiFetch, isOwner, load]);

  useEffect(() => {
    if (!ready || !token || !isOwner || !activeId) {
      return;
    }
    void loadDetail(activeId);
  }, [ready, token, apiFetch, isOwner, activeId, loadDetail]);

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!activeId || sending) {
      return;
    }
    setSending(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/platform/tickets/${activeId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply, isInternal: internal, ...(nextStatus ? { status: nextStatus } : {}) }),
      });
      const parsed = (await response.json()) as { data: { id: string } } | ApiError;
      if (isFailure(response, parsed)) {
        throw new Error(parsed.error?.message ?? "Could not send the reply.");
      }
      setReply("");
      setInternal(false);
      setNotice(internal ? "Internal note saved — the school cannot see it." : "Reply sent — the school sees it in their thread.");
      await loadDetail(activeId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSending(false);
    }
  }

  if (!ready) {
    return (
      <Shell role="PLATFORM_OWNER" activeHref="/owner/support">
        <h1 style={{ ...h1Style, marginBottom: 14 }}>Support</h1>
        <SkeletonBlocks rows={4} />
      </Shell>
    );
  }

  if (!token || !isOwner) {
    return (
      <Shell role="PLATFORM_OWNER" activeHref="/owner/support">
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Support</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: 0 }}>The support console lives with the Platform Owner.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell role="PLATFORM_OWNER" activeHref="/owner/support">
      <h1 style={h1Style}>Support</h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>School threads, internal notes included.</p>

      <div className="sf-row-wrap" style={{ marginBottom: 12 }}>
        {(["", "OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const).map((s) => (
          <button
            key={s || "ALL"}
            type="button"
            onClick={() => {
              setStatusFilter(s);
              setActiveId("");
              setDetail(null);
            }}
            className="sf-btn"
            style={s === statusFilter ? { borderColor: colors.primary, fontWeight: 700 } : undefined}
          >
            {s || "All"}
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "0 0 12px" }}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p style={{ color: colors.success, fontSize: 14, margin: "0 0 12px" }}>{notice}</p>
      ) : null}

      {loading ? (
        <SkeletonBlocks rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<LifeBuoy size={20} aria-hidden="true" />}
          title="No tickets"
          detail="Schools open threads from their Support page."
        />
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="sf-row-wrap">
            {rows.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setActiveId(t.id);
                  void loadDetail(t.id);
                }}
                className="sf-btn"
                style={t.id === activeId ? { borderColor: colors.primary, fontWeight: 700 } : undefined}
              >
                {t.school.name} · {t.subject}
              </button>
            ))}
          </div>
          {detail && detail.id === activeId ? (
            <div className="sf-card" style={{ ...cardStyle }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                <strong style={{ color: colors.ink, fontSize: 15, flex: 1 }}>{detail.subject}</strong>
                <span style={statusPill(detail.status)}>{detail.status}</span>
                <span style={pill(colors.inkSoft, colors.primaryGhost)}>{detail.priority}</span>
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                {detail.messages.map((m) => (
                  <li key={m.id} style={{ fontSize: 14, color: colors.ink, borderTop: "1px solid rgba(15,23,42,.08)", paddingTop: 8 }}>
                    {m.isInternal ? (
                      <span style={{ ...pill(colors.warning, colors.warningTint), marginRight: 8 }}>INTERNAL</span>
                    ) : null}
                    {m.body}
                  </li>
                ))}
              </ul>
              <form onSubmit={(e) => void send(e)} className="sf-row-wrap" style={{ marginTop: 12 }}>
                <input
                  className="sf-input"
                  style={{ flex: 2, minWidth: 200 }}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Write a reply…"
                  aria-label="Owner reply"
                  maxLength={4000}
                />
                <select
                  className="sf-input"
                  style={{ flex: 0 }}
                  value={nextStatus}
                  onChange={(e) => setNextStatus(e.target.value)}
                  aria-label="Move status"
                >
                  <option value="">Keep status</option>
                  <option value="OPEN">Open</option>
                  <option value="IN_PROGRESS">In progress</option>
                  <option value="RESOLVED">Resolved</option>
                  <option value="CLOSED">Closed</option>
                </select>
                <label style={{ fontSize: 13, color: colors.inkSoft, display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                  Internal note
                </label>
                <button type="submit" style={primaryBtn} disabled={sending || reply.trim().length === 0}>
                  {sending ? "Sending…" : "Send"}
                </button>
              </form>
            </div>
          ) : null}
        </div>
      )}
    </Shell>
  );
}
