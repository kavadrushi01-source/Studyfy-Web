"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { io, type Socket } from "socket.io-client";
import { MessageCircle, RefreshCw, Send } from "lucide-react";
import { EmptyState, SkeletonBlocks } from "../../components/ui/shell";
import { isFailure } from "../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, gradients, h1Style, h2Style, labelStyle, mutedStyle, pageFrame, pill, primaryBtn, shadows } from "@/lib/theme";

interface ThreadRow {
  user: { id: string; name: string };
  lastMessage: { body: string; fromMe: boolean };
  unread: number;
}

interface ChatMessage {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  sender: { id: string; name: string };
}

interface ApiError {
  error: { code: string; message: string };
}

type ConnState = "offline" | "connecting" | "live" | "reconnecting";

// Compact controls for the 280px thread rail.
const sidebarLabel: React.CSSProperties = { ...labelStyle };
const sidebarControl: React.CSSProperties = { fontSize: 13, padding: "8px 10px" };

// 1:1 academic chat (§7 Phase 1 #8). Thread list + message view in board
// styling; WHO may talk to WHOM is enforced API-side (§13.7) and surfaced
// as-is. The socket is live updates only — send/read always go through
// HTTP, so chat keeps working (degraded, manual refresh) even with the
// socket down. Identity (school + token) comes from the shared session
// (useAuth); the socket handshake uses the session token.
//
// Reconnection is VISIBLE by design (§12.5): Render's free tier
// cold-starts the API after inactivity and drops the socket — a normal,
// expected event here, not a bug. The banner always shows the true state:
// live (green), connecting/reconnecting (amber, with the attempt count),
// offline (red, with a real retry button that reconnects the same socket).
// Never a silently dead chat.
export default function MessagesPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [activeUserId, setActiveUserId] = useState("");
  const [contacts, setContacts] = useState<{ userId: string; name: string; role: string; context: string }[]>([]);
  const [newRecipient, setNewRecipient] = useState("");
  const [newBody, setNewBody] = useState("");
  const [starting, setStarting] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [conn, setConn] = useState<ConnState>("offline");
  const [attempts, setAttempts] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const activeUserIdRef = useRef(activeUserId);

  useEffect(() => {
    activeUserIdRef.current = activeUserId;
  }, [activeUserId]);

  // Socket base URL only — every HTTP call goes through apiFetch.
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  const loadThreads = useCallback(async () => {
    if (!schoolId) {
      throw new Error("Please sign in to view messages.");
    }
    const response = await apiFetch(`/api/v1/schools/${schoolId}/messages/threads`);
    const body = (await response.json()) as { data: { threads: ThreadRow[] } } | ApiError;
    if (isFailure(response, body)) {
      throw new Error(body.error?.message ?? "Failed to load threads.");
    }
    setThreads(body.data.threads);
  }, [schoolId, apiFetch]);

  const loadThread = useCallback(
    async (userId: string) => {
      if (!schoolId) {
        return;
      }
      setLoading(true);
      setError("");
      try {
        const response = await apiFetch(`/api/v1/schools/${schoolId}/messages?with=${userId}`);
        const body = (await response.json()) as { data: { messages: ChatMessage[] } } | ApiError;
        if (isFailure(response, body)) {
          throw new Error(body.error?.message ?? "Failed to load messages.");
        }
        setMessages(body.data.messages);
        setActiveUserId(userId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setLoading(false);
      }
    },
    [schoolId, apiFetch],
  );

  // Initial threads + startable contacts load once the session is ready.
  useEffect(() => {
    if (!ready || !token || !schoolId) {
      return;
    }
    void loadThreads().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Network error.");
    });
    void (async () => {
      try {
        const response = await apiFetch(`/api/v1/schools/${schoolId}/messages/contacts`);
        const body = (await response.json()) as {
          data: { contacts: { userId: string; name: string; role: string; context: string }[] };
        } | ApiError;
        if (!isFailure(response, body)) {
          setContacts(body.data.contacts);
        }
      } catch {
        // Picker stays empty — existing threads still work.
      }
    })();
  }, [ready, token, schoolId, loadThreads, apiFetch]);

  // Socket lifecycle: namespace derived from the school, token in handshake
  // auth (mirrors the server's §12.5 contract — never a client room name).
  // Rebuilt whenever the session token (or school) changes; torn down on
  // unmount. The active thread is read through a ref so switching threads
  // never rebuilds the socket.
  useEffect(() => {
    if (!ready || !schoolId || !token) {
      return undefined;
    }
    setConn("connecting");
    const socket = io(`${api}/school-${schoolId}`, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: Infinity,
      timeout: 8000,
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      setConn("live");
      setAttempts(0);
      void loadThreads();
      const current = activeUserIdRef.current;
      if (current) {
        void loadThread(current);
      }
    });
    socket.on("disconnect", () => {
      setConn("reconnecting");
    });
    socket.on("reconnect_attempt", (n: number) => {
      setAttempts(n);
      setConn("reconnecting");
    });
    socket.on("reconnect_failed", () => {
      setConn("offline");
    });
    socket.on("connect_error", () => {
      // Stays on connecting/reconnecting via the handlers above; a hard
      // auth failure (bad token) surfaces here instead of retrying forever.
      setConn((prev) => (prev === "live" ? "reconnecting" : prev));
    });
    socket.on("message:new", (payload: { threadId?: string }) => {
      void payload;
      void loadThreads();
      const current = activeUserIdRef.current;
      if (current) {
        void loadThread(current);
      }
    });
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [ready, api, schoolId, token, loadThreads, loadThread]);

  // Manual retry for the offline badge: reconnects the SAME socket (keeps
  // every listener + the auto-reconnect config intact). Falls back to a
  // plain threads refresh when the socket is gone entirely.
  function retrySocket(): void {
    setError("");
    const socket = socketRef.current;
    if (socket) {
      setConn("connecting");
      socket.connect();
      return;
    }
    void (async () => {
      try {
        setConn("connecting");
        await loadThreads();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
        setConn("offline");
      }
    })();
  }

  // Start a first-contact thread from the picker (every listed recipient
  // is pre-cleared by the §13.7 matrix server-side).
  async function startThread(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!newRecipient || !newBody.trim() || !schoolId) {
      return;
    }
    setStarting(true);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverId: newRecipient, body: newBody.trim() }),
      });
      const body = (await response.json()) as { data: { message: unknown } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Send failed.");
      }
      setNewRecipient("");
      setNewBody("");
      await loadThreads();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setStarting(false);
    }
  }

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {    event.preventDefault();
    if (!draft.trim() || !activeUserId) {
      return;
    }
    if (!schoolId) {
      setError("Please sign in to send a message.");
      return;
    }
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverId: activeUserId, body: draft.trim() }),
      });
      const body = (await response.json()) as { data: { message: unknown } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Send failed.");
      }
      setDraft("");
      await loadThread(activeUserId);
      await loadThreads();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  const threadsCard: React.CSSProperties = {
    width: 280,
    flexShrink: 0,
    padding: 16,
  };
  const chatCard: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    minHeight: 440,
  };
  const connColor = conn === "live" ? colors.success : conn === "offline" ? colors.danger : colors.warning;
  const connTint = conn === "live" ? colors.successTint : conn === "offline" ? colors.dangerTint : colors.warningTint;
  const connPill: React.CSSProperties = {
    ...pill(connColor, connTint),
    fontFamily: "inherit",
    fontSize: 12,
    padding: "4px 10px",
  };
  const titleStyle: React.CSSProperties = { ...h1Style, flex: 1, display: "flex", alignItems: "center", gap: 8 };

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={titleStyle}>
          <MessageCircle size={22} aria-hidden="true" color={colors.primary} /> Messages
        </h1>
        <div style={{ marginTop: 20 }}>
          <SkeletonBlocks rows={3} height={64} />
        </div>
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={titleStyle}>
          <MessageCircle size={22} aria-hidden="true" color={colors.primary} /> Messages
        </h1>
        <div className="sf-card" style={{ padding: 20, marginTop: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: "0 0 8px" }}>Please sign in to view messages.</p>
          <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <div className="sf-row-wrap" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <h1 style={titleStyle}>
          <MessageCircle size={22} aria-hidden="true" color={colors.primary} /> Messages
        </h1>
        {conn === "offline" ? (
          <button
            type="button"
            onClick={retrySocket}
            style={{ ...connPill, cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}
            title="Reconnect the live socket"
          >
            <RefreshCw size={13} aria-hidden="true" /> Offline — Retry
          </button>
        ) : (
          <span role="status" style={connPill}>
            {conn === "live" ? "Live" : attempts > 0 ? `Reconnecting… (attempt ${attempts})` : "Connecting…"}
          </span>
        )}
      </div>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        1:1 academic chat — the socket is live updates only; sending always works over HTTP.
      </p>
      <div className="sf-split">
        <section className="sf-card" style={threadsCard}>
          <h3 style={h2Style}>Threads</h3>
          {contacts.length > 0 ? (
            <form onSubmit={startThread} style={{ display: "grid", gap: 8, marginBottom: 12 }}>
              <label style={sidebarLabel}>
                New message
                <select
                  className="sf-select"
                  style={sidebarControl}
                  value={newRecipient}
                  onChange={(e) => setNewRecipient(e.target.value)}
                  aria-label="Recipient"
                >
                  <option value="">— pick someone —</option>
                  {contacts.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {c.name} ({c.context})
                    </option>
                  ))}
                </select>
              </label>
              <input
                className="sf-input"
                style={sidebarControl}
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                placeholder="First message…"
                aria-label="First message"
              />
              <button
                type="submit"
                disabled={starting || !newRecipient || !newBody.trim()}
                style={{ ...primaryBtn, opacity: starting ? 0.6 : 1, justifyContent: "center" }}
              >
                {starting ? "Starting…" : "Start conversation"}
              </button>
            </form>
          ) : null}
          {threads.length === 0 ? (
            <EmptyState
              icon={<MessageCircle size={22} aria-hidden="true" />}
              title="No conversations yet"
              detail="Threads appear here once someone writes to you."
            />
          ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr)" }}>
              {threads.map((t) => {
                const active = t.user.id === activeUserId;
                return (
                  <li key={t.user.id}>
                    <button
                      type="button"
                      onClick={() => void loadThread(t.user.id)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: `1px solid ${active ? colors.primary : colors.line}`,
                        background: active ? colors.primaryGhost : "#fff",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        boxShadow: active ? "0 6px 14px -10px rgba(37,99,235,.9)" : "none",
                        transition:
                          "background 160ms cubic-bezier(.22,1,.36,1), border-color 160ms cubic-bezier(.22,1,.36,1), box-shadow 160ms cubic-bezier(.22,1,.36,1)",
                      }}
                      onMouseEnter={(e) => {
                        if (!active) {
                          e.currentTarget.style.background = "#F8FAFF";
                          e.currentTarget.style.borderColor = "#CBD5E1";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!active) {
                          e.currentTarget.style.background = "#fff";
                          e.currentTarget.style.borderColor = colors.line;
                        }
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 14, color: colors.ink }}>
                        {t.user.name}
                        {t.unread > 0 ? (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 11,
                              fontWeight: 700,
                              background: gradients.primary,
                              color: "#fff",
                              borderRadius: 999,
                              padding: "1px 8px",
                            }}
                          >
                            {t.unread}
                          </span>
                        ) : null}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: colors.muted,
                          marginTop: 2,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.lastMessage.fromMe ? "You: " : ""}
                        {t.lastMessage.body}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="sf-card" style={chatCard}>
          {!activeUserId ? (
            <EmptyState
              icon={<MessageCircle size={22} aria-hidden="true" />}
              title="Pick a thread"
              detail="Choose a conversation to read and reply."
            />
          ) : (
            <>
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  marginBottom: 12,
                  padding: 12,
                  borderRadius: 12,
                  background: "#F8FAFD",
                  border: `1px solid ${colors.lineSoft}`,
                }}
              >
                {loading ? (
                  <SkeletonBlocks rows={3} height={40} />
                ) : messages.length === 0 ? (
                  <EmptyState
                    icon={<MessageCircle size={22} aria-hidden="true" />}
                    title="No messages yet"
                    detail="Say hello — it lands instantly over HTTP."
                  />
                ) : (
                  messages.map((m) => {
                    const mine = user != null && m.senderId === user.id;
                    const bubble: React.CSSProperties = mine
                      ? {
                          background: gradients.primary,
                          color: "#fff",
                          boxShadow: shadows.primary,
                          borderBottomRightRadius: 4,
                        }
                      : {
                          background: "#fff",
                          color: colors.inkSoft,
                          border: `1px solid ${colors.line}`,
                          boxShadow: shadows.card,
                          borderBottomLeftRadius: 4,
                        };
                    return (
                      <div
                        key={m.id}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: mine ? "flex-end" : "flex-start",
                          marginBottom: 12,
                        }}
                      >
                        <div style={{ fontSize: 11, color: colors.faint, margin: "0 4px 4px" }}>
                          {m.sender.name} · {new Date(m.createdAt).toLocaleString("en-GB")}
                        </div>
                        <div
                          style={{
                            ...bubble,
                            maxWidth: "78%",
                            padding: "10px 14px",
                            borderRadius: 14,
                            fontSize: 14,
                            lineHeight: 1.5,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          {m.body}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              {user?.role === "SCHOOL_ADMIN" ? (
                <p style={{ ...mutedStyle, fontSize: 13, margin: "4px 0 0" }}>
                  Oversight view — admins read conversations here but never send messages.
                </p>
              ) : (
                <form onSubmit={send} className="sf-row-wrap">
                  <input
                    className="sf-input"
                    style={{ flex: 1, minWidth: 180 }}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Write a message…"
                    aria-label="Message"
                  />
                  <button type="submit" style={primaryBtn}>
                    <Send size={14} aria-hidden="true" /> Send
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      </div>
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
