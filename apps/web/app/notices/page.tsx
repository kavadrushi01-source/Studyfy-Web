"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Megaphone, Send } from "lucide-react";
import { EmptyState, SkeletonBlocks } from "../../components/ui/shell";
import { SignInGate, actionSignInMessage } from "../../components/ui/sign-in-gate";
import { isFailure } from "../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { cardStyle, colors, h1Style, h2Style, labelStyle, mutedStyle, pageFrame, pill, primaryBtn } from "@/lib/theme";

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
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  // Publish is ADMIN/TEACHER API-side; pupils/parents only read the board
  // (and lack sections.read), so the form and its sections fetch stay
  // staff-only.
  const canPublish = user?.role === "TEACHER" || user?.role === "SCHOOL_ADMIN";
  const [notices, setNotices] = useState<Notice[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<Target>("SCHOOL");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [sectionOptions, setSectionOptions] = useState<{ id: string; name: string; classId: string; className: string }[]>([]);
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
      // Class/section dropdowns for targeting (names, not IDs). Staff-only:
      // pupils/parents get 403 from /sections, so never ask.
      if (canPublish) {
        const sectionsRes = await apiFetch(`/api/v1/schools/${schoolId}/sections`);
        const sectionsBody = (await sectionsRes.json()) as {
          data: { sections: { id: string; name: string; class: { id: string; name: string } }[] };
        } | ApiError;
        if (!isFailure(sectionsRes, sectionsBody)) {
          setSectionOptions(
            sectionsBody.data.sections.map((s) => ({ id: s.id, name: s.name, classId: s.class.id, className: s.class.name })),
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, apiFetch, canPublish]);

  useEffect(() => {
    if (!ready || !token || !schoolId) {
      return;
    }
    void load();
  }, [ready, token, schoolId, apiFetch, load]);

  async function publish(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId) {
      setError(actionSignInMessage("Please sign in to publish a notice.", token, schoolId));
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

  // Withdraw a notice. The board could publish and list but never edit or
  // delete, so a notice sent to the wrong audience (or with a typo) stayed on
  // every student and parent board permanently.
  const withdraw = async (noticeId: string, noticeTitle: string) => {
    if (!schoolId) {
      return;
    }
    if (!window.confirm(`Withdraw "${noticeTitle}"? It disappears from every board immediately.`)) {
      return;
    }
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/notices/${noticeId}`, { method: "DELETE" });
      const data = (await response.json()) as { data: { deleted: string } } | ApiError;
      if (isFailure(response, data)) {
        setError(data.error?.message ?? `Request failed (${response.status}).`);
        return;
      }
      setNotice("Notice withdrawn.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  };

  const targetTint = (value: string): React.CSSProperties =>
    value === "SCHOOL"
      ? pill(colors.primary, colors.primaryGhost, "#C7DDFB")
      : value === "CLASS"
        ? pill(colors.accent, colors.accentTint, "#DDD3FB")
        : pill("#0D9488", "#EDFBF7", "#C3ECE4");

  const card: React.CSSProperties = { ...cardStyle, marginBottom: 12 };
  const titleStyle: React.CSSProperties = { ...h1Style, display: "flex", alignItems: "center", gap: 8 };

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...titleStyle, margin: "0 0 12px" }}>
          <Megaphone size={22} aria-hidden="true" color={colors.primary} /> Notice Board
        </h1>
        <SkeletonBlocks rows={3} height={64} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...titleStyle, margin: "0 0 12px" }}>
          <Megaphone size={22} aria-hidden="true" color={colors.primary} /> Notice Board
        </h1>
        <SignInGate prompt="Please sign in to view notices." />
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={titleStyle}>
        <Megaphone size={22} aria-hidden="true" color={colors.primary} /> Notice Board
      </h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        School-wide by default — narrow to a class or section when it matters.
      </p>
      {canPublish ? (
      <section style={{ ...cardStyle, marginBottom: 16 }}>
        <h2 style={h2Style}>Publish notice (staff)</h2>
        <form onSubmit={publish} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={labelStyle}>
            Title
            <input className="sf-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label style={labelStyle}>
            Message
            <textarea
              className="sf-textarea"
              style={{ minHeight: 80, resize: "vertical" }}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
            />
          </label>
          <div className="sf-row-wrap">
            <label style={{ ...labelStyle, flex: 1, minWidth: 180 }}>
              Audience
              <select
                className="sf-select"
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
              <label style={{ ...labelStyle, flex: 1, minWidth: 180 }}>
                Class
                {sectionOptions.length > 0 ? (
                  <select className="sf-select" value={classId} onChange={(e) => setClassId(e.target.value)} required aria-label="Class">
                    <option value="">— pick a class —</option>
                    {[...new Map(sectionOptions.map((s) => [s.classId, s.className])).entries()].map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="sf-input"
                    value={classId}
                    onChange={(e) => setClassId(e.target.value)}
                    placeholder="Class ID for class-wide notice"
                    required
                  />
                )}
              </label>
            ) : null}
            {target === "SECTION" ? (
              <label style={{ ...labelStyle, flex: 1, minWidth: 180 }}>
                Section
                {sectionOptions.length > 0 ? (
                  <select className="sf-select" value={sectionId} onChange={(e) => setSectionId(e.target.value)} required aria-label="Section">
                    <option value="">— pick a section —</option>
                    {sectionOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.className} {s.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="sf-input"
                    value={sectionId}
                    onChange={(e) => setSectionId(e.target.value)}
                    placeholder="Section ID for section notice"
                    required
                  />
                )}
              </label>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={publishing}
            style={{ ...primaryBtn, alignSelf: "flex-start", opacity: publishing ? 0.6 : 1 }}
          >
            <Send size={14} aria-hidden="true" /> {publishing ? "Publishing…" : "Publish notice"}
          </button>
        </form>
      </section>
      ) : null}
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
              <h3
                style={{
                  margin: 0,
                  flex: 1,
                  fontSize: 16,
                  fontWeight: 700,
                  letterSpacing: "-0.015em",
                  color: colors.ink,
                }}
              >
                {n.title}
              </h3>
              <span style={targetTint(n.target)}>{n.target}</span>
            </div>
            <p style={{ whiteSpace: "pre-wrap", color: colors.inkSoft, fontSize: 14, lineHeight: 1.6, margin: "10px 0 8px" }}>
              {n.body}
            </p>
            <small style={{ color: colors.muted, fontSize: 12 }}>
              {n.createdBy.name} · {new Date(n.createdAt).toLocaleDateString("en-GB")}
            </small>
            {canPublish ? (
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => void withdraw(n.id, n.title)}
                  style={{
                    border: `1px solid ${colors.danger}55`,
                    background: "transparent",
                    color: colors.danger,
                    borderRadius: 8,
                    padding: "6px 12px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Withdraw
                </button>
              </div>
            ) : null}
          </article>
        ))
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
