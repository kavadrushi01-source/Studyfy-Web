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

interface OwnerTicketAttachment {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
}

interface OwnerTicketMsg {
  id: string;
  authorId: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  attachments: OwnerTicketAttachment[];
}

interface OwnerTicketDetail extends OwnerTicketRow {
  messages: OwnerTicketMsg[];
  createdById: string;
  createdBy: { name: string };
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
// school side by API construction). Queue filters (status pills, priority,
// school slug), reply visible or internal, move status AND priority (each
// audited under its own action), close. Impersonation (§13.9) stays a later
// chunk — this console only talks.
export default function OwnerSupportPage() {
  const { token, ready, apiFetch, user, startImpersonation } = useAuth();
  const isOwner = user?.role === "PLATFORM_OWNER";
  const [rows, setRows] = useState<OwnerTicketRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  // Slug filter applies on button press (not keystroke): every keystroke
  // would refetch the queue. appliedSlug is what the API sees.
  const [slugInput, setSlugInput] = useState("");
  const [appliedSlug, setAppliedSlug] = useState("");
  const [activeId, setActiveId] = useState("");
  const [detail, setDetail] = useState<OwnerTicketDetail | null>(null);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [nextStatus, setNextStatus] = useState("");
  const [nextPriority, setNextPriority] = useState("");
  const [sending, setSending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  // Impersonation starter (§13.9): reason pre-filled with the ticket
  // reference when a thread opens; the founder can extend it before
  // starting. The reporter is always staff (only staff open tickets).
  const [impReason, setImpReason] = useState("");
  const [impStarting, setImpStarting] = useState(false);

  function resetSelection(): void {
    setActiveId("");
    setDetail(null);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (statusFilter) {
        params.set("status", statusFilter);
      }
      if (priorityFilter) {
        params.set("priority", priorityFilter);
      }
      if (appliedSlug.trim()) {
        params.set("schoolSlug", appliedSlug.trim());
      }
      const query = params.toString();
      const response = await apiFetch(`/api/v1/platform/tickets${query ? `?${query}` : ""}`);
      const body = (await response.json()) as { data: { tickets: OwnerTicketRow[] } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Failed to load tickets.");
      }
      setRows(body.data.tickets);
      if (body.data.tickets.length > 0 && !activeId) {
        const first = body.data.tickets[0];
        setActiveId(first?.id ?? "");
        if (first) {
          setImpReason(`Ticket ${first.id} — ${first.subject}`.slice(0, 500));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, statusFilter, priorityFilter, appliedSlug, activeId]);

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
        setNextPriority("");
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
      // Screenshot attached → multipart attach endpoint (same internal /
      // status / priority semantics); otherwise the plain JSON message
      // endpoint.
      const moveStatus = nextStatus ? { status: nextStatus } : {};
      const movePriority = nextPriority ? { priority: nextPriority } : {};
      const response = file
        ? await (() => {
            const form = new FormData();
            form.append("file", file, file.name);
            form.append("message", reply);
            form.append("isInternal", internal ? "true" : "false");
            if (nextStatus) {
              form.append("status", nextStatus);
            }
            if (nextPriority) {
              form.append("priority", nextPriority);
            }
            return apiFetch(`/api/v1/platform/tickets/${activeId}/attachments`, { method: "POST", body: form });
          })()
        : await apiFetch(`/api/v1/platform/tickets/${activeId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body: reply, isInternal: internal, ...moveStatus, ...movePriority }),
          });
      const parsed = (await response.json()) as { data: { id: string } } | ApiError;
      if (isFailure(response, parsed)) {
        throw new Error(parsed.error?.message ?? "Could not send the reply.");
      }
      setReply("");
      setInternal(false);
      setFile(null);
      setNotice(
        [
          internal ? "Internal note saved — the school cannot see it." : "Reply sent — the school sees it in their thread.",
          nextPriority ? ` Priority moved to ${nextPriority}.` : "",
          nextStatus ? ` Status moved to ${nextStatus}.` : "",
        ].join(""),
      );
      setNextStatus("");
      setNextPriority("");
      await loadDetail(activeId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSending(false);
    }
  }

  // Impersonate this thread's reporter (§13.9): read-only, 30 minutes,
  // reason pre-filled with the ticket reference. Lands on the school
  // desk as the reporter; the banner there offers the exit.
  async function impersonateReporter(): Promise<void> {
    if (!detail || impStarting) {
      return;
    }
    setImpStarting(true);
    setError("");
    setNotice("");
    try {
      await startImpersonation({ targetUserId: detail.createdById, reason: impReason });
      window.location.href = "/support";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start impersonation.");
    } finally {
      setImpStarting(false);
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
              resetSelection();
            }}
            className="sf-btn"
            style={s === statusFilter ? { borderColor: colors.primary, fontWeight: 700 } : undefined}
          >
            {s || "All"}
          </button>
        ))}
        <select
          className="sf-input"
          style={{ flex: 0 }}
          value={priorityFilter}
          onChange={(e) => {
            setPriorityFilter(e.target.value);
            resetSelection();
          }}
          aria-label="Filter priority"
        >
          <option value="">All priorities</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
        </select>
        <input
          className="sf-input"
          style={{ flex: 1, minWidth: 160 }}
          value={slugInput}
          onChange={(e) => setSlugInput(e.target.value)}
          placeholder="School slug — e.g. school-of-science"
          aria-label="Filter school slug"
          maxLength={120}
        />
        <button
          type="button"
          className="sf-btn"
          onClick={() => {
            setAppliedSlug(slugInput.trim());
            resetSelection();
          }}
        >
          Apply school
        </button>
        <button
          type="button"
          className="sf-btn"
          onClick={() => {
            setStatusFilter("");
            setPriorityFilter("");
            setSlugInput("");
            setAppliedSlug("");
            resetSelection();
          }}
        >
          Clear filters
        </button>
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
                  setImpReason(`Ticket ${t.id} — ${t.subject}`.slice(0, 500));
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
                    {(m.attachments ?? []).map((a) => (
                      <span key={a.id} style={{ display: "block", marginTop: 4 }}>
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: colors.primary, fontWeight: 600, fontSize: 13, textDecoration: "none" }}
                        >
                          {a.originalName}
                        </a>{" "}
                        <span style={{ ...mutedStyle, fontSize: 12 }}>
                          ({a.mimeType}, {(a.sizeBytes / 1024).toFixed(1)} KB)
                        </span>
                      </span>
                    ))}
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
                <select
                  className="sf-input"
                  style={{ flex: 0 }}
                  value={nextPriority}
                  onChange={(e) => setNextPriority(e.target.value)}
                  aria-label="Move priority"
                >
                  <option value="">Keep priority</option>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                </select>
                <label style={{ fontSize: 13, color: colors.inkSoft, display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                  Internal note
                </label>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  aria-label="Attach a screenshot"
                />
                <button
                  type="submit"
                  style={primaryBtn}
                  disabled={sending || (reply.trim().length === 0 && !file)}
                >
                  {sending ? "Sending…" : file ? "Send with screenshot" : "Send"}
                </button>
              </form>
              <div style={{ marginTop: 12, borderTop: "1px solid rgba(15,23,42,.08)", paddingTop: 12 }}>
                <p style={{ fontSize: 13, fontWeight: 700, margin: "0 0 8px", color: colors.ink }}>
                  Impersonate the reporter — read-only, 30 minutes
                </p>
                <div className="sf-row-wrap">
                  <input
                    className="sf-input"
                    style={{ flex: 2, minWidth: 200 }}
                    value={impReason}
                    onChange={(e) => setImpReason(e.target.value)}
                    placeholder="Reason — ticket reference pre-filled"
                    aria-label="Impersonation reason"
                    maxLength={500}
                  />
                  <button
                    type="button"
                    onClick={() => void impersonateReporter()}
                    disabled={impStarting || impReason.trim().length < 8}
                    style={primaryBtn}
                  >
                    {impStarting ? "Starting…" : `Impersonate ${detail.createdBy.name}`}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Shell>
  );
}
