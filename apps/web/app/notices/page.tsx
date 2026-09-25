"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Megaphone, Send } from "lucide-react";
import { EmptyState, SkeletonBlocks } from "../../components/ui/shell";
import { isFailure } from "../../lib/api";
import { useAuth } from "@/lib/auth-context";

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

type Target = "SCHOOL" | "CLASS" | "SECTION";

// Notice board (Phase 1 Chunk 1, spec §7 #7). Lists what the caller's scope
// allows (staff: everything; students/parents: school-wide plus own
// class/section — decided API-side). Publishing is staff-only and supports
// school-wide (default), class, and section targeting — the API emails
// affected parents/staff and reports the count back. Identity comes from
// the shared session (useAuth).
export default function NoticesPage() {
  const { token, schoolId, ready, apiFetch } = useAuth();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<Target>("SCHOOL");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!schoolId) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/notices`);
      const data = (await response.json()) as { data: { notices: Notice[] } } | ApiError;
      if (isFailure(response, data)) {
        setError(data.error?.message ?? `Request failed (${response.status}).`);
        return;
      }
      setNotices(data.data.notices);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, apiFetch]);

  useEffect(() => {
    if (!ready || !token || !schoolId) {
      return;
    }
    void load();
  }, [ready, token, schoolId, apiFetch, load]);

  async function publish(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId) {
      setError("Please sign in to publish a notice.");
      return;
    }
    setPublishing(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/notices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body,
          target,
          ...(target === "CLASS" ? { classId: classId.trim() } : {}),
          ...(target === "SECTION" ? { sectionId: sectionId.trim() } : {}),
        }),
      });
      const data = (await response.json()) as { data: { emailed: number } } | ApiError;
      if (isFailure(response, data)) {
        setError(data.error?.message ?? `Request failed (${response.status}).`);
        return;
      }
      setTitle("");
      setBody("");
      setClassId("");
      setSectionId("");
      setNotice(`Published — emailed to ${data.data.emailed} recipients.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setPublishing(false);
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
  const input: React.CSSProperties = {
    display: "block",
    width: "100%",
    margin: "4px 0 12px",
    padding: 10,
    borderRadius: 10,
    border: "1px solid #CBD5E1",
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
  const card: React.CSSProperties = {
    background: "#fff",
    borderRadius: 14,
    boxShadow: "0 1px 3px rgba(15,23,42,.08)",
    padding: 16,
    marginBottom: 12,
  };
  const targetColor = (value: string): string =>
    value === "SCHOOL" ? "#2563EB" : value === "CLASS" ? "#7C3AED" : "#0D9488";

  if (!ready) {
    return (
      <main style={page}>
        <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
          <Megaphone size={22} aria-hidden="true" color="#2563EB" /> Notice Board
        </h1>
        <SkeletonBlocks rows={3} height={64} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={page}>
        <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
          <Megaphone size={22} aria-hidden="true" color="#2563EB" /> Notice Board
        </h1>
        <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(15,23,42,.08)", padding: 20 }}>
          <p style={{ color: "#334155" }}>Please sign in to view notices.</p>
          <Link href="/login" style={{ color: "#2563EB", fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={page}>
      <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
        <Megaphone size={22} aria-hidden="true" color="#2563EB" /> Notice Board
      </h1>
      <p style={{ color: "#64748B", margin: "0 0 20px", fontSize: 14 }}>
        School-wide by default — narrow to a class or section when it matters.
      </p>
      <section style={{ ...card, padding: 20, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: 16, color: "#0F172A" }}>Publish notice (staff)</h2>
        <form onSubmit={publish}>
          <label>
            Title
            <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label>
            Message
            <textarea style={{ ...input, minHeight: 80 }} value={body} onChange={(e) => setBody(e.target.value)} required />
          </label>
          <div className="sf-row-wrap">
            <label style={{ flex: 1, minWidth: 180 }}>
              Audience
              <select
                style={input}
                value={target}
                onChange={(e) => setTarget(e.target.value as Target)}
                aria-label="Notice audience"
              >
                <option value="SCHOOL">Whole school</option>
                <option value="CLASS">One class</option>
                <option value="SECTION">One section</option>
              </select>
            </label>
            {target === "CLASS" ? (
              <label style={{ flex: 1, minWidth: 180 }}>
                Class ID
                <input
                  style={input}
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                  placeholder="Class ID for class-wide notice"
                  required
                />
              </label>
            ) : null}
            {target === "SECTION" ? (
              <label style={{ flex: 1, minWidth: 180 }}>
                Section ID
                <input
                  style={input}
                  value={sectionId}
                  onChange={(e) => setSectionId(e.target.value)}
                  placeholder="Section ID for section notice"
                  required
                />
              </label>
            ) : null}
          </div>
          <button type="submit" disabled={publishing} style={{ ...primaryBtn, opacity: publishing ? 0.6 : 1 }}>
            <Send size={14} aria-hidden="true" /> {publishing ? "Publishing…" : "Publish notice"}
          </button>
        </form>
      </section>
      {loading ? (
        <SkeletonBlocks rows={3} height={64} />
      ) : notices.length === 0 ? (
        <EmptyState
          icon={<Megaphone size={22} aria-hidden="true" />}
          title="No notices yet"
          detail="Published notices will appear here as they go out."
        />
      ) : (
        notices.map((n) => (
          <article key={n.id} style={card}>
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
      {notice ? <p style={{ color: "#059669" }}>{notice}</p> : null}
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
