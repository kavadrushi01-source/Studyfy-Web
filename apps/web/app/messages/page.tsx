"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";

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
// socket down.
//
// Reconnection is VISIBLE by design (§12.5): Render's free tier
// cold-starts the API after inactivity and drops the socket — a normal,
// expected event here, not a bug. The banner always shows the true state:
// live (green), connecting/reconnecting (amber, with the attempt count),
// offline (red, retry button). Never a silently dead chat.
export default function MessagesPage() {
  const [schoolId, setSchoolId] = useState("");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [activeUserId, setActiveUserId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [conn, setConn] = useState<ConnState>("offline");
  const [attempts, setAttempts] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const socketRef = useRef<Socket | null>(null);

  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const auth = { Authorization: `Bearer ${token}` };

  const loadThreads = useCallback(async () => {
    const response = await fetch(`${api}/api/v1/schools/${schoolId}/messages/threads`, { headers: auth });
    const body = (await response.json()) as { data: { threads: ThreadRow[] } } | ApiError;
    if (!response.ok || "error" in body) {
      throw new Error("error" in body ? (body.error?.message ?? "Failed to load threads.") : "Failed to load threads.");
    }
    setThreads(body.data.threads);
  }, [api, schoolId, token]);

  const loadThread = useCallback(
    async (userId: string) => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${api}/api/v1/schools/${schoolId}/messages?with=${userId}`, { headers: auth });
        const body = (await response.json()) as { data: { messages: ChatMessage[] } } | ApiError;
        if (!response.ok || "error" in body) {
          throw new Error("error" in body ? (body.error?.message ?? "Failed to load messages.") : "Failed to load messages.");
        }
        setMessages(body.data.messages);
        setActiveUserId(userId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setLoading(false);
      }
    },
    [api, schoolId, token],
  );

  // Socket lifecycle: namespace derived from the school, token in handshake
  // auth (mirrors the server's §12.5 contract — never a client room name).
  // Rebuilt whenever school/token change; torn down on unmount.
  useEffect(() => {
    if (!connected || !schoolId || !token) {
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
      if (activeUserId) {
        void loadThread(activeUserId);
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
      if (activeUserId) {
        void loadThread(activeUserId);
      }
    });
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [connected, schoolId, token]);

  async function connect(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    try {
      await loadThreads();
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!draft.trim() || !activeUserId) {
      return;
    }
    setError("");
    try {
      const response = await fetch(`${api}/api/v1/schools/${schoolId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({ receiverId: activeUserId, body: draft.trim() }),
      });
      const body = (await response.json()) as { data: { message: unknown } } | ApiError;
      if (!response.ok || "error" in body) {
        const message =
          "error" in body ? (body.error?.message ?? "Send failed.") : "Send failed.";
        throw new Error(message);
      }
      setDraft("");
      await loadThread(activeUserId);
      await loadThreads();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  const input = { display: "block", width: "100%", margin: "4px 0 12px", padding: 8 } as const;
  const connColor = conn === "live" ? "#059669" : conn === "offline" ? "#DC2626" : "#D97706";
  const connLabel =
    conn === "live"
      ? "Live"
      : conn === "offline"
        ? "Offline — Retry"
        : attempts > 0
          ? `Reconnecting… (attempt ${attempts})`
          : "Connecting…";

  return (
    <main style={{ maxWidth: 1000, margin: "32px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ flex: 1 }}>Messages</h1>
        {connected ? (
          <span
            role="status"
            style={{ fontSize: 13, padding: "4px 12px", borderRadius: 999, border: `1px solid ${connColor}`, color: connColor }}
          >
            {connLabel}
          </span>
        ) : null}
      </div>
      {!connected ? (
        <form onSubmit={connect}>
          <label>
            School ID
            <input style={input} value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required />
          </label>
          <label>
            Bearer token (dev only — login screen replaces this)
            <input style={input} value={token} onChange={(e) => setToken(e.target.value)} required />
          </label>
          <button type="submit">Connect</button>
        </form>
      ) : (
        <div style={{ display: "flex", gap: 16 }}>
          <section style={{ width: 280, background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(15,23,42,.08)", padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Threads</h3>
            {threads.length === 0 ? (
              <p style={{ color: "#64748B" }}>No conversations yet.</p>
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
                        borderRadius: 8,
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
          <section style={{ flex: 1, background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(15,23,42,.08)", padding: 12, display: "flex", flexDirection: "column", minHeight: 400 }}>
            {!activeUserId ? (
              <p style={{ color: "#64748B" }}>Pick a thread to read and reply.</p>
            ) : (
              <>
                <div style={{ flex: 1, overflowY: "auto", marginBottom: 12 }}>
                  {loading ? (
                    <div>
                      {[0, 1, 2].map((i) => (
                        <div key={i} style={{ height: 40, borderRadius: 8, background: "#F1F5F9", marginBottom: 8 }} />
                      ))}
                    </div>
                  ) : messages.length === 0 ? (
                    <p style={{ color: "#64748B" }}>No messages yet — say hello.</p>
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
                <form onSubmit={send} style={{ display: "flex", gap: 8 }}>
                  <input
                    style={{ flex: 1, padding: 8 }}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Write a message…"
                    aria-label="Message"
                  />
                  <button type="submit">Send</button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
