"use client";

import { useCallback, useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { EmptyState, SkeletonBlocks } from "../../components/ui/shell";
import { SignInGate } from "../../components/ui/sign-in-gate";
import { isFailure } from "../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, labelStyle, mutedStyle, pageFrame, pill, primaryBtn } from "@/lib/theme";

interface AuditLog {
  id: string;
  schoolId: string | null;
  actorId: string | null;
  impersonatedBy: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: Record<string, string | number | boolean | null> | null;
  after: Record<string, string | number | boolean | null> | null;
  createdAt: string;
}

interface ApiError {
  error: { code: string; message: string };
}

// Audit logs (§13.10): the school's oversight trail — who changed what,
// when. Admin-only; teachers and office staff without the key see the gate
// note below (the API 403s them too). Actor IDs stay IDs on purpose: names
// resolve in the Super Admin panel, not in a tenant-scoped join.
export default function AuditLogsPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const canView = user?.role === "SCHOOL_ADMIN";
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState("");
  // Data export (§13.10): whole-school ZIP, one per hour, audited. The
  // export rows land in this same trail (filter DATA_EXPORT to see them).
  const [exporting, setExporting] = useState(false);
  const [expNotice, setExpNotice] = useState("");
  const [expError, setExpError] = useState("");

  async function exportSchool(): Promise<void> {
    if (!schoolId || exporting) {
      return;
    }
    setExporting(true);
    setExpNotice("");
    setExpError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/exports`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json()) as ApiError;
        throw new Error(body.error?.message ?? "Export failed.");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "studyfy-export.zip";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setExpNotice("Export downloaded — filter DATA_EXPORT to see its audit row.");
    } catch (err) {
      setExpError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setExporting(false);
    }
  }

  const buildQuery = useCallback(
    (cursor: string | null) => {
      const params = new URLSearchParams();
      params.set("take", "50");
      if (action.trim()) {
        params.set("action", action.trim());
      }
      if (actorId.trim()) {
        params.set("actorId", actorId.trim());
      }
      if (from) {
        params.set("from", from);
      }
      if (to) {
        params.set("to", to);
      }
      if (cursor) {
        params.set("cursor", cursor);
      }
      return params.toString();
    },
    [action, actorId, from, to],
  );

  const load = useCallback(
    async (cursor: string | null, append: boolean) => {
      if (!schoolId) {
        return;
      }
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError("");
      try {
        const response = await apiFetch(`/api/v1/schools/${schoolId}/audit-logs?${buildQuery(cursor)}`);
        const body = (await response.json()) as { data: { logs: AuditLog[]; nextCursor: string | null } } | ApiError;
        if (isFailure(response, body)) {
          throw new Error(body.error?.message ?? "Failed to load audit logs.");
        }
        setLogs((prev) => (append ? [...prev, ...body.data.logs] : body.data.logs));
        setNextCursor(body.data.nextCursor);
      } catch (err) {
        if (!append) {
          setLogs([]);
        }
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [schoolId, apiFetch, buildQuery],
  );

  useEffect(() => {
    if (!ready || !token || !schoolId || !canView) {
      return;
    }
    void load(null, false);
  }, [ready, token, schoolId, apiFetch, canView, load]);

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Audit Logs</h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Audit Logs</h1>
        <SignInGate prompt="Please sign in to view audit logs." />
      </main>
    );
  }

  if (!canView) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Audit Logs</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: 0 }}>
            Audit logs are for the School Admin — your boards carry your own records.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={h1Style}>Audit Logs</h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        Who changed what, newest first — admissions, marks, attendance edits, fees, devices and certificates.
      </p>
      <div className="sf-card" style={{ padding: 16, marginBottom: 12 }}>
        <div className="sf-row-wrap" style={{ alignItems: "center" }}>
          <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: colors.ink, flex: 1, minWidth: 200 }}>
            Data export — whole-school ZIP, one per hour
          </p>
          <button type="button" onClick={() => void exportSchool()} disabled={exporting} style={primaryBtn}>
            {exporting ? "Exporting…" : "Download export"}
          </button>
        </div>
        {expNotice ? <p style={{ color: colors.success, fontSize: 14, margin: "8px 0 0" }}>{expNotice}</p> : null}
        {expError ? (
          <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "8px 0 0" }}>
            {expError}
          </p>
        ) : null}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setNextCursor(null);
          void load(null, false);
        }}
        className="sf-row-wrap"
        style={{ alignItems: "flex-end", marginBottom: 12 }}
      >
        <label style={{ ...labelStyle, flex: 1, minWidth: 140 }}>
          Action
          <input
            className="sf-input"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="MARK_UPDATE"
            aria-label="Action filter"
          />
        </label>
        <label style={{ ...labelStyle, flex: 1, minWidth: 140 }}>
          Actor ID
          <input
            className="sf-input"
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            placeholder="User id"
            aria-label="Actor filter"
          />
        </label>
        <label style={labelStyle}>
          From
          <input
            className="sf-input"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From date filter"
          />
        </label>
        <label style={labelStyle}>
          To
          <input
            className="sf-input"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To date filter"
          />
        </label>
        <button type="submit" disabled={loading} style={{ ...primaryBtn, opacity: loading ? 0.6 : 1 }}>
          {loading ? "Loading…" : "Apply"}
        </button>
      </form>

      {loading ? (
        <SkeletonBlocks rows={4} />
      ) : logs.length === 0 ? (
        <EmptyState
          icon={<ScrollText size={22} aria-hidden="true" />}
          title="No audit rows match"
          detail="Activity appears here as staff work — or clear the filters."
        />
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
          {logs.map((log) => (
            <li key={log.id} className="sf-card" style={{ padding: 16 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={pill(colors.primary, colors.primaryGhost)}>{log.action}</span>
                <span style={pill(colors.inkSoft, colors.primaryGhost)}>{log.entity}</span>
                <span style={{ ...mutedStyle, fontSize: 13, flex: 1 }}>
                  {new Date(log.createdAt).toLocaleString("en-GB")}
                </span>
                <button
                  type="button"
                  onClick={() => setOpenId((prev) => (prev === log.id ? "" : log.id))}
                  className="sf-btn"
                  aria-expanded={openId === log.id}
                >
                  {openId === log.id ? "Hide detail" : "Detail"}
                </button>
              </div>
              <p style={{ ...mutedStyle, fontSize: 13, margin: "6px 0 0" }}>
                Actor {log.actorId ? log.actorId.slice(0, 8) : "system"}
                {log.entityId ? ` · record ${log.entityId.slice(0, 8)}` : ""}
                {log.impersonatedBy ? " · via impersonation" : ""}
              </p>
              {openId === log.id ? (
                <div style={{ marginTop: 10, borderTop: "1px solid #F1F5F9", paddingTop: 10 }}>
                  {log.before ? (
                    <p style={{ fontSize: 13, color: colors.inkSoft, margin: "0 0 6px" }}>
                      Before: <code>{JSON.stringify(log.before)}</code>
                    </p>
                  ) : null}
                  {log.after ? (
                    <p style={{ fontSize: 13, color: colors.inkSoft, margin: 0 }}>
                      After: <code>{JSON.stringify(log.after)}</code>
                    </p>
                  ) : null}
                  {!log.before && !log.after ? (
                    <p style={{ fontSize: 13, color: colors.inkSoft, margin: 0 }}>No field snapshot on this row.</p>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {nextCursor && !loading ? (
        <button
          type="button"
          onClick={() => void load(nextCursor, true)}
          disabled={loadingMore}
          className="sf-btn"
          style={{ marginTop: 12 }}
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      ) : null}
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
