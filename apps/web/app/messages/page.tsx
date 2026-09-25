"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { io, type Socket } from "socket.io-client";
import { MessageCircle, RefreshCw, Send } from "lucide-react";
import { EmptyState, SkeletonBlocks } from "../../components/ui/shell";
import { isFailure } from "../../lib/api";
import { useAuth } from "@/lib/auth-context";

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
  const { token, schoolId, ready, apiFetch } = useAuth();
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [activeUserId, setActiveUserId] = useState("");
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

  // Initial threads load once the session is ready.
  useEffect(() => {
    if (!ready || !token || !schoolId) {
      return;
    }
    void loadThreads().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Network error.");
    });
  }, [ready, token, schoolId, loadThreads]);

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

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
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

  const page: React.CSSProperties = {
    maxWidth: 1120,
    margin: "0 auto",
    padding: 28,
    fontFamily: "Inter, system-ui, sans-serif",
    background: "#F8FAFC",
    minHeight: "100vh",
  };
  const primaryBtn: React.CSSProperties = {
    background: "#2563EB",
    color: "#fff",
    border: 0,
    borderRadius: 10,
    padding: "10px 16px",
    fontWeight: 600,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };
  const threadsCard: React.CSSProperties = {
    width: 280,
    flexShrink: 0,
    background: "#fff",
    borderRadius: 14,
    boxShadow: "0 1px 3px rgba(15,23,42,.08)",
    padding: 12,
  };
  const chatCard: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    background: "#fff",
    borderRadius: 14,
    boxShadow: "0 1px 3px rgba(15,23,42,.08)",
    padding: 12,
    display: "flex",
    flexDirection: "column",
    minHeight: 400,
  };
  const connColor = conn === "live" ? "#059669" : conn === "offline" ? "#DC2626" : "#D97706";
  const connPill: React.CSSProperties = {
    fontSize: 13,
    padding: "4px 12px",
    borderRadius: 999,
    border: `1px solid ${connColor}`,
    color: connColor,
    background: "#fff",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };

  if (!ready) {
    return (
      <main style={page}>
        <h1 style={{ fontSize: 26, margin: 0, color: "#0F172A", flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
          <MessageCircle size={22} aria-hidden="true" color="#2563EB" /> Messages
        </h1>
        <div style={{ marginTop: 20 }}>
          <SkeletonBlocks rows={3} height={64} />
        </div>
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={page}>
        <h1 style={{ fontSize: 26, margin: 0, color: "#0F172A", flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
          <MessageCircle size={22} aria-hidden="true" color="#2563EB" /> Messages
        </h1>
        <div
          style={{
            background: "#fff",
            borderRadius: 14,
            boxShadow: "0 1px 3px rgba(15,23,42,.08)",
            padding: 20,
            marginTop: 20,
          }}
        >
          <p style={{ color: "#334155" }}>Please sign in to view messages.</p>
          <Link href="/login" style={{ color: "#2563EB", fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={page}>
      <div className="sf-row-wrap" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <h1 style={{ fontSize: 26, margin: 0, color: "#0F172A", flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
          <MessageCircle size={22} aria-hidden="true" color="#2563EB" /> Messages
        </h1>
        {conn === "offline" ? (
          <button type="button" onClick={retrySocket} style={{ ...connPill, cursor: "pointer", fontWeight: 600 }} title="Reconnect the live socket">
            <RefreshCw size={13} aria-hidden="true" /> Offline — Retry
          </button>
        ) : (
          <span role="status" style={connPill}>
            {conn === "live" ? "Live" : attempts > 0 ? `Reconnecting… (attempt ${attempts})` : "Connecting…"}
          </span>
        )}
      </div>
      <p style={{ color: "#64748B", margin: "0 0 20px", fontSize: 14 }}>
        1:1 academic chat — the socket is live updates only; sending always works over HTTP.
      </p>
      <div className="sf-split">
        <section style={threadsCard}>
          <h3 style={{ marginTop: 0 }}>Threads</h3>
          {threads.length === 0 ? (
            <EmptyState
              icon={<MessageCircle size={22} aria-hidden="true" />}
              title="No conversations yet"
              detail="Threads appear here once someone writes to you."
            />
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {threads.map((t) => (
                <li key={t.user.id} style={{ marginBottom: 4 }}>
                  <button
                    type="button"
                    onClick={() => void loadThread(t.user.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: 8,
                      borderRadius: 12,
                      border: t.user.id === activeUserId ? "1px solid #2563EB" : "1px solid #E2E8F0",
                      background: t.user.id === activeUserId ? "#EFF6FF" : "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {t.user.name}
                      {t.unread > 0 ? (
                        <span style={{ marginLeft: 8, fontSize: 12, background: "#2563EB", color: "#fff", borderRadius: 999, padding: "0 8px" }}>
                          {t.unread}
                        </span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 12, color: "#64748B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.lastMessage.fromMe ? "You: " : ""}
                      {t.lastMessage.body}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section style={chatCard}>
          {!activeUserId ? (
            <EmptyState
              icon={<MessageCircle size={22} aria-hidden="true" />}
              title="Pick a thread"
              detail="Choose a conversation to read and reply."
            />
          ) : (
            <>
              <div style={{ flex: 1, overflowY: "auto", marginBottom: 12 }}>
                {loading ? (
                  <SkeletonBlocks rows={3} height={40} />
                ) : messages.length === 0 ? (
                  <EmptyState
                    icon={<MessageCircle size={22} aria-hidden="true" />}
                    title="No messages yet"
                    detail="Say hello — it lands instantly over HTTP."
                  />
                ) : (
                  messages.map((m) => (
                    <div key={m.id} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: "#64748B" }}>
                        {m.sender.name} · {new Date(m.createdAt).toLocaleString("en-GB")}
                      </div>
                      <div style={{ fontSize: 14 }}>{m.body}</div>
                    </div>
                  ))
                )}
              </div>
              <form onSubmit={send} className="sf-row-wrap">
                <input
                  style={{ flex: 1, minWidth: 180, padding: 10, borderRadius: 10, border: "1px solid #CBD5E1" }}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Write a message…"
                  aria-label="Message"
                />
                <button type="submit" style={primaryBtn}>
                  <Send size={14} aria-hidden="true" /> Send
                </button>
              </form>
            </>
          )}
        </section>
      </div>
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
