"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LifeBuoy } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { cardStyle, colors, h1Style, mutedStyle, pageFrame, pill, primaryBtn } from "@/lib/theme";
import { isFailure } from "../../lib/api";
import { EmptyState, SkeletonBlocks } from "../../components/ui/shell";

interface TicketRow {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
}

interface TicketAttachment {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
}

interface TicketMsg {
  id: string;
  authorId: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  attachments: TicketAttachment[];
}

interface TicketDetail extends TicketRow {
  messages: TicketMsg[];
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

// School support desk (§7 Phase 4 #27): open threads to the platform and
// read the platform's visible replies. Internal notes NEVER reach this
// screen — the API filters them in the query, so there is nothing here to
// accidentally render. Suspended schools keep this page (§13.4): asking
// for help must work especially when billing broke. School Admin sees the
// whole school's threads; staff open their own and see only those (API
// enforces the split — this gate just mirrors it).
const STAFF_ROLES = new Set(["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT", "LIBRARIAN", "TRANSPORT_MANAGER"]);
export default function SupportPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const canView = STAFF_ROLES.has(user?.role ?? "");
  // Staff list is scoped API-side to tickets they opened — say so, so the
  // shorter list never reads as "the rest vanished".
  const isStaff = canView && user?.role !== "SCHOOL_ADMIN";
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [opening, setOpening] = useState(false);
  const [activeId, setActiveId] = useState("");
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    if (!schoolId) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/support/tickets`);
      const body = (await response.json()) as { data: { tickets: TicketRow[] } } | ApiError;
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
  }, [schoolId, apiFetch, activeId]);

  const loadDetail = useCallback(
    async (ticketId: string) => {
      if (!schoolId || !ticketId) {
        return;
      }
      try {
        const response = await apiFetch(`/api/v1/schools/${schoolId}/support/tickets/${ticketId}`);
        const body = (await response.json()) as { data: { ticket: TicketDetail } } | ApiError;
        if (isFailure(response, body)) {
          throw new Error(body.error?.message ?? "Failed to load the thread.");
        }
        setDetail(body.data.ticket);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      }
    },
    [schoolId, apiFetch],
  );

  useEffect(() => {
    if (!ready || !token || !schoolId || !canView) {
      return;
    }
    void load();
  }, [ready, token, schoolId, apiFetch, canView, load]);

  useEffect(() => {
    if (!ready || !token || !schoolId || !canView || !activeId) {
      return;
    }
    void loadDetail(activeId);
  }, [ready, token, schoolId, apiFetch, canView, activeId, loadDetail]);

  async function open(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId || opening) {
      return;
    }
    setOpening(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/support/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, priority }),
      });
      const body = (await response.json()) as { data: { id: string } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not open the ticket.");
      }
      setSubject("");
      setNotice("Ticket opened — the platform team will reply here.");
      await load();
      setActiveId(body.data.id);
      await loadDetail(body.data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setOpening(false);
    }
  }

  async function sendReply(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId || !activeId || replying) {
      return;
    }
    setReplying(true);
    setError("");
    try {
      // Screenshot attached → multipart attach endpoint (message rides
      // along, defaulting server-side to the file name); otherwise the
      // plain JSON message endpoint.
      const response = file
        ? await (() => {
            const form = new FormData();
            form.append("file", file, file.name);
            form.append("message", reply);
            return apiFetch(`/api/v1/schools/${schoolId}/support/tickets/${activeId}/attachments`, {
              method: "POST",
              body: form,
            });
          })()
        : await apiFetch(`/api/v1/schools/${schoolId}/support/tickets/${activeId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body: reply }),
          });
      const parsed = (await response.json()) as { data: { id: string } } | ApiError;
      if (isFailure(response, parsed)) {
        throw new Error(parsed.error?.message ?? "Could not send the reply.");
      }
      setReply("");
      setFile(null);
      await loadDetail(activeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setReplying(false);
    }
  }

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, marginBottom: 14 }}>Support</h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId || !canView) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Support</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: 0 }}>Support tickets open from your school's admin or staff desk — students and parents go through their school.</p>
        </div>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={h1Style}>Support</h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        {isStaff ? "Threads you opened with the platform team." : "Threads with the platform team."}
      </p>

      <div className="sf-card" style={{ ...cardStyle, marginBottom: 16 }}>
        <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: colors.ink }}>Open a ticket</p>
        <form onSubmit={(e) => void open(e)} className="sf-row-wrap">
          <input
            className="sf-input"
            style={{ flex: 2, minWidth: 200 }}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject — e.g. Fee receipt mismatch"
            aria-label="Ticket subject"
            maxLength={120}
          />
          <select
            className="sf-input"
            style={{ flex: 0 }}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            aria-label="Ticket priority"
          >
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </select>
          <button type="submit" style={primaryBtn} disabled={opening || subject.trim().length < 4}>
            {opening ? "Opening…" : "Open ticket"}
          </button>
        </form>
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
          title="No tickets yet"
          detail="Open one above — the platform team replies in this thread."
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
                {t.subject}
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
              <form onSubmit={(e) => void sendReply(e)} className="sf-row-wrap" style={{ marginTop: 12 }}>
                <input
                  className="sf-input"
                  style={{ flex: 2, minWidth: 200 }}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Write a reply…"
                  aria-label="Thread reply"
                  maxLength={4000}
                />
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  aria-label="Attach a screenshot"
                />
                <button
                  type="submit"
                  style={primaryBtn}
                  disabled={replying || (reply.trim().length === 0 && !file)}
                >
                  {replying ? "Sending…" : file ? "Reply with screenshot" : "Reply"}
                </button>
              </form>
            </div>
          ) : null}
        </div>
      )}
    </main>
  );
}
