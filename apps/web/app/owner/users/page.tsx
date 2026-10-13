"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { EmptyState, Shell, SkeletonBlocks } from "../../../components/ui/shell";
import { isFailure } from "../../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, labelStyle, mutedStyle, pageFrame, pill, primaryBtn } from "@/lib/theme";

interface PlatformUser {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  role: { name: string };
  school: { id: string; name: string; slug: string } | null;
}

interface ApiError {
  error: { code: string; message: string };
}

const MANAGEABLE_ROLES = ["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT", "STUDENT", "PARENT", "LIBRARIAN", "TRANSPORT_MANAGER"];

// Users Management (§7 #23): account administration ONLY —
// activate/deactivate, role assignment. Never academic data (this screen
// shows ids, emails, roles, schools, active flags — nothing else), and
// Platform Owner accounts are untouchable here (the API refuses both
// directions; owner management stays manual/out-of-band).
export default function OwnerUsersPage() {
  const { token, ready, apiFetch, user } = useAuth();
  const isOwner = user?.role === "PLATFORM_OWNER";
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [schoolId, setSchoolId] = useState("");
  const [role, setRole] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [acting, setActing] = useState("");
  const [roleFor, setRoleFor] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ take: "100" });
      if (schoolId.trim()) {
        params.set("schoolId", schoolId.trim());
      }
      if (role) {
        params.set("role", role);
      }
      if (query.trim()) {
        params.set("q", query.trim());
      }
      const response = await apiFetch(`/api/v1/platform/users?${params.toString()}`);
      const body = (await response.json()) as { data: { users: PlatformUser[] } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Failed to load users.");
      }
      setUsers(body.data.users);
    } catch (err) {
      setUsers([]);
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, schoolId, role, query]);

  useEffect(() => {
    if (!ready || !token || !isOwner) {
      return;
    }
    void load();
  }, [ready, token, isOwner, apiFetch, load]);

  async function setActive(id: string, isActive: boolean): Promise<void> {
    setActing(`active-${id}`);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/platform/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      const body = (await response.json()) as { data?: unknown } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Update failed.");
      }
      setNotice(isActive ? "Account re-activated." : "Account deactivated — locked at next login.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setActing("");
    }
  }

  // Password-reset link (§7 #23): single-use 1-hour token by email — the
  // token itself never appears here (only in the mailbox). Disabled
  // accounts refuse server-side (reactivate first); demo addresses are
  // suppressed by the mail choke point, reported honestly below.
  async function sendReset(id: string, email: string): Promise<void> {
    setActing(`reset-${id}`);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/platform/users/${id}/password-reset`, { method: "POST" });
      const body = (await response.json()) as { data: { emailed: boolean } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Reset failed.");
      }
      setNotice(
        body.data.emailed
          ? `Password reset link sent to ${email}.`
          : `Reset link created for ${email}, but the email could not be delivered (demo address or mail unset).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setActing("");
    }
  }

  async function changeRole(id: string): Promise<void> {
    const next = roleFor[id];
    if (!next) {
      setError("Pick a role first.");
      return;
    }
    setActing(`role-${id}`);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/platform/users/${id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next }),
      });
      const body = (await response.json()) as { data?: unknown } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Role change failed.");
      }
      setNotice(`Role changed to ${next}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setActing("");
    }
  }

  const gate = (title: string, detail: React.ReactNode) => (
    <Shell role="PLATFORM_OWNER" activeHref="/owner/users">
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Users Management</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: "0 0 8px" }}>{title}</p>
          {detail}
        </div>
      </main>
    </Shell>
  );

  if (!ready) {
    return (
      <Shell role="PLATFORM_OWNER" activeHref="/owner/users">
        <main style={pageFrame}>
          <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Users Management</h1>
          <SkeletonBlocks rows={4} />
        </main>
      </Shell>
    );
  }

  if (!token) {
    return gate("Please sign in as the Platform Owner.", <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>Go to login</Link>);
  }

  if (!isOwner) {
    return gate("Platform access only — your school boards carry your own data.", null);
  }

  return (
    <Shell role="PLATFORM_OWNER" activeHref="/owner/users">
      <main style={pageFrame}>
        <h1 style={h1Style}>Users Management</h1>
        <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
          Accounts only — activate, deactivate, re-role. Academic data lives in school routes this panel never touches.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
          className="sf-row-wrap"
          style={{ alignItems: "flex-end", marginBottom: 12 }}
        >
          <label style={{ ...labelStyle, flex: 1, minWidth: 140 }}>
            School ID
            <input
              className="sf-input"
              value={schoolId}
              onChange={(e) => setSchoolId(e.target.value)}
              placeholder="Optional filter"
              aria-label="School filter"
            />
          </label>
          <label style={labelStyle}>
            Role
            <select className="sf-select" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role filter">
              <option value="">All roles</option>
              {MANAGEABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
              <option value="PLATFORM_OWNER">PLATFORM_OWNER</option>
            </select>
          </label>
          <label style={{ ...labelStyle, flex: 1, minWidth: 140 }}>
            Search
            <input
              className="sf-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or email"
              aria-label="Search name or email"
            />
          </label>
          <button type="submit" disabled={loading} style={{ ...primaryBtn, opacity: loading ? 0.6 : 1 }}>
            {loading ? "Loading…" : "Apply"}
          </button>
        </form>

        {loading ? (
          <SkeletonBlocks rows={4} />
        ) : users.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={22} aria-hidden="true" />}
            title="No accounts match"
            detail="Clear the filters — every login account on the platform lists here."
          />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
            {users.map((u) => (
              <li key={u.id} className="sf-card" style={{ padding: 16 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <strong style={{ color: colors.ink, fontSize: 15, flex: 1 }}>{u.name}</strong>
                  <span style={pill(colors.primary, colors.primaryGhost)}>{u.role.name}</span>
                  <span style={u.isActive ? pill(colors.success, colors.successTint) : pill(colors.danger, colors.dangerTint)}>
                    {u.isActive ? "Active" : "Disabled"}
                  </span>
                </div>
                <p style={{ ...mutedStyle, fontSize: 13, margin: "6px 0 0" }}>
                  {u.email} · {u.school ? `${u.school.name} (${u.school.slug})` : "platform (no school)"}
                </p>
                {u.role.name === "PLATFORM_OWNER" ? (
                  <p style={{ ...mutedStyle, fontSize: 13, margin: "8px 0 0" }}>
                    Managed out-of-band — this panel never touches owner accounts.
                  </p>
                ) : (
                  <div className="sf-row-wrap" style={{ marginTop: 10, alignItems: "flex-end" }}>
                    <button
                      type="button"
                      onClick={() => void setActive(u.id, !u.isActive)}
                      disabled={!!acting}
                      className="sf-btn"
                    >
                      {acting === `active-${u.id}` ? "Working…" : u.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                    <label style={labelStyle}>
                      Role
                      <select
                        className="sf-select"
                        value={roleFor[u.id] ?? ""}
                        onChange={(e) => setRoleFor((prev) => ({ ...prev, [u.id]: e.target.value }))}
                        aria-label={`Role for ${u.email}`}
                      >
                        <option value="">Pick…</option>
                        {MANAGEABLE_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => void changeRole(u.id)}
                      disabled={!!acting}
                      className="sf-btn"
                    >
                      {acting === `role-${u.id}` ? "Working…" : "Set role"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void sendReset(u.id, u.email)}
                      disabled={!!acting}
                      className="sf-btn"
                    >
                      {acting === `reset-${u.id}` ? "Working…" : "Send reset link"}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {notice ? <p style={{ color: colors.success, fontSize: 14, margin: "12px 0 0" }}>{notice}</p> : null}
        {error ? (
          <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
            {error}
          </p>
        ) : null}
      </main>
    </Shell>
  );
}
