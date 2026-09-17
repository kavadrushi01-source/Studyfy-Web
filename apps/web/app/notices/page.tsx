"use client";

import { useCallback, useState, type FormEvent } from "react";

interface Notice {
  id: string;
  title: string;
  body: string;
  target: string;
  createdAt: string;
  createdBy: { name: string };
}

interface ApiError {
  error: { code: string; message: string };
}

// Pre-dashboard notice board (Phase 1 Chunk 1, spec §7 #7). Lists what the
// caller's scope allows (staff: everything; students/parents: school-wide
// plus own class/section — decided API-side). Publishing is staff-only;
// the API emails affected parents/staff and reports the count back.
// Same token-paste dev workflow as the other screens until login lands.
export default function NoticesPage() {
  const [schoolId, setSchoolId] = useState("");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const auth = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${api}/api/v1/schools/${schoolId}/notices`, { headers: auth });
      const data = (await response.json()) as { data: { notices: Notice[] } } | ApiError;
      if (!response.ok || "error" in data) {
        const message =
          "error" in data ? (data.error?.message ?? `Request failed (${response.status}).`) : `Request failed (${response.status}).`;
        setError(message);
        return;
      }
      setNotices(data.data.notices);
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [api, schoolId, token]);

  function connect(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void load();
  }

  async function publish(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${api}/api/v1/schools/${schoolId}/notices`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({ title, body, target: "SCHOOL" }),
      });
      const data = (await response.json()) as { data: { emailed: number } } | ApiError;
      if (!response.ok || "error" in data) {
        const message =
          "error" in data ? (data.error?.message ?? `Request failed (${response.status}).`) : `Request failed (${response.status}).`;
        setError(message);
        return;
      }
      setTitle("");
      setBody("");
      setNotice(`Published — emailed to ${data.data.emailed} recipients.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  const input = { display: "block", width: "100%", margin: "4px 0 12px", padding: 8 } as const;
  const targetColor = (target: string): string =>
    target === "SCHOOL" ? "#2563EB" : target === "CLASS" ? "#7C3AED" : "#0D9488";

  return (
    <main style={{ maxWidth: 900, margin: "32px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>Notice Board</h1>
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
        <>
          <section style={{ background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(15,23,42,.08)", padding: 16, marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>Publish notice (staff)</h2>
            <form onSubmit={publish}>
              <label>
                Title
                <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} required />
              </label>
              <label>
                Message
                <textarea style={{ ...input, minHeight: 80 }} value={body} onChange={(e) => setBody(e.target.value)} required />
              </label>
              <button type="submit">Publish school-wide</button>
            </form>
          </section>
          {loading ? (
            <div>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ height: 64, borderRadius: 14, background: "#F1F5F9", marginBottom: 12 }} />
              ))}
            </div>
          ) : (
            notices.map((n) => (
              <article
                key={n.id}
                style={{ background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(15,23,42,.08)", padding: 16, marginBottom: 12 }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <h3 style={{ margin: 0, flex: 1 }}>{n.title}</h3>
                  <span
                    style={{
                      fontSize: 12,
                      padding: "2px 10px",
                      borderRadius: 999,
                      border: `1px solid ${targetColor(n.target)}`,
                      color: targetColor(n.target),
                    }}
                  >
                    {n.target}
                  </span>
                </div>
                <p style={{ whiteSpace: "pre-wrap" }}>{n.body}</p>
                <small style={{ color: "#64748B" }}>
                  {n.createdBy.name} · {new Date(n.createdAt).toLocaleDateString("en-GB")}
                </small>
              </article>
            ))
          )}
        </>
      )}
      {notice ? <p style={{ color: "#059669" }}>{notice}</p> : null}
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
