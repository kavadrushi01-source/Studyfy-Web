"use client";

import { useCallback, useEffect, useState } from "react";
import { SignInLink } from "@/components/ui/sign-in-gate";
import { ScrollText } from "lucide-react";
import { EmptyState, Shell, SkeletonBlocks } from "../../../components/ui/shell";
import { isFailure } from "../../../lib/api";
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

// Platform audit reads (§13.10): every school's rows AND the NULL
// platform-level rows, one shared trail. Same cursor + filter shape as the
// school board, plus the school filter. Read-only, like everything the
// owner sees outside their own actions.
export default function OwnerAuditLogsPage() {
  const { token, ready, apiFetch, user } = useAuth();
  const isOwner = user?.role === "PLATFORM_OWNER";
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filterSchoolId, setFilterSchoolId] = useState("");
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState("");

  const buildQuery = useCallback(
    (cursor: string | null) => {
      const params = new URLSearchParams();
      params.set("take", "50");
      if (filterSchoolId.trim()) {
        params.set("schoolId", filterSchoolId.trim());
      }
      if (action.trim()) {
        params.set("action", action.trim());
      }
      if (actorId.trim()) {
        params.set("actorId", actorId.trim());
      }
      if (cursor) {
        params.set("cursor", cursor);
      }
      return params.toString();
    },
    [filterSchoolId, action, actorId],
  );

  const load = useCallback(
    async (cursor: string | null, append: boolean) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError("");
      try {
        const response = await apiFetch(`/api/v1/platform/audit-logs?${buildQuery(cursor)}`);
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
    [apiFetch, buildQuery],
  );

  useEffect(() => {
    if (!ready || !token || !isOwner) {
      return;
    }
    void load(null, false);
  }, [ready, token, isOwner, apiFetch, load]);

  const gate = (title: string, detail: React.ReactNode) => (
    <Shell role="PLATFORM_OWNER" activeHref="/owner/audit-logs">
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Audit Logs</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: "0 0 8px" }}>{title}</p>
          {detail}
        </div>
      </main>
    </Shell>
  );

  if (!ready) {
    return (
      <Shell role="PLATFORM_OWNER" activeHref="/owner/audit-logs">
        <main style={pageFrame}>
          <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Audit Logs</h1>
          <SkeletonBlocks rows={4} />
        </main>
      </Shell>
    );
  }

  if (!token) {
    return gate("Please sign in as the Platform Owner.", <SignInLink style={{ color: colors.primary, fontWeight: 600 }}>Go to login</SignInLink>);
  }

  if (!isOwner) {
    return gate("Platform access only — your school boards carry your own data.", null);
  }

  return (
    <Shell role="PLATFORM_OWNER" activeHref="/owner/audit-logs">
      <main style={pageFrame}>
        <h1 style={h1Style}>Audit Logs</h1>
        <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
          The whole platform&apos;s trail — every school plus platform-level rows (NULL school), newest first.
        </p>
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
            School ID
            <input
              className="sf-input"
              value={filterSchoolId}
              onChange={(e) => setFilterSchoolId(e.target.value)}
              placeholder="Optional filter"
              aria-label="School filter"
            />
          </label>
          <label style={{ ...labelStyle, flex: 1, minWidth: 140 }}>
            Action
            <input
              className="sf-input"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="SUBSCRIPTION_STATUS_CHANGE"
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
            detail="Activity appears here as schools work — or clear the filters."
          />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
            {logs.map((log) => (
              <li key={log.id} className="sf-card" style={{ padding: 16 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={pill(colors.primary, colors.primaryGhost)}>{log.action}</span>
                  <span style={pill(colors.inkSoft, colors.primaryGhost)}>{log.entity}</span>
                  <span style={pill(colors.warning, colors.warningTint)}>{log.schoolId ? log.schoolId.slice(0, 8) : "platform"}</span>
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
    </Shell>
  );
}
