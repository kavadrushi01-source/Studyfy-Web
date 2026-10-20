"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { UserPlus, Users } from "lucide-react";
import { DataTable } from "../../components/ui/data-table";
import { Card, EmptyState, SkeletonBlocks } from "../../components/ui/shell";
import { SignInGate } from "../../components/ui/sign-in-gate";
import { isFailure } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  colors,
  h1Style,
  h2Style,
  iconTile,
  labelStyle,
  mutedStyle,
  pageFrame,
  pill,
} from "@/lib/theme";

interface StaffRow {
  id: string;
  designation: string;
  user: { id: string; name: string; email: string; role: { name: string } };
}

interface StaffResponse {
  data: { staff: StaffRow[] };
  meta: null;
  error: { code: string; message: string } | null;
}

// Teachers directory (§8.4 admin nav): roster plus invite form. Inviting
// creates the login + staff row together; the temp password shows once,
// like admission — hand it to the teacher directly.
export default function TeachersPage() {
  const { token, schoolId, ready, apiFetch } = useAuth();
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("TEACHER");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ email: string; tempPassword: string } | null>(null);

  const load = useCallback(async () => {
    if (!schoolId) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/staff`);
      const body = (await response.json()) as StaffResponse;
      if (!response.ok || body.error) {
        setError(body.error?.message ?? `Request failed (${response.status}).`);
        return;
      }
      setRows(body.data.staff);
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

  async function invite(event: FormEvent): Promise<void> {
    event.preventDefault();
    setInviting(true);
    setError("");
    setInviteResult(null);
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/staff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), role }),
      });
      const body = (await response.json()) as {
        data: { staff: StaffRow; tempPassword: string };
      } | StaffResponse;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Invite failed.");
      }
      if (!("tempPassword" in body.data)) {
        throw new Error("Invite failed.");
      }
      setInviteResult({ email: body.data.staff.user.email, tempPassword: body.data.tempPassword });
      setName("");
      setEmail("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setInviting(false);
    }
  }

  const errorAlert = {
    margin: "0 0 16px",
    padding: "10px 14px",
    borderRadius: 12,
    background: colors.dangerTint,
    border: "1px solid rgba(220,38,38,.28)",
    color: colors.danger,
    fontSize: 14,
  };
  const successNotice = {
    margin: "12px 0 0",
    padding: "10px 14px",
    borderRadius: 12,
    background: colors.successTint,
    border: "1px solid rgba(5,150,105,.28)",
    color: colors.success,
    fontSize: 14,
    fontWeight: 600,
  };

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, marginBottom: 8 }}>Teachers</h1>
        <SkeletonBlocks rows={3} height={52} />
      </main>
    );
  }
  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, marginBottom: 8 }}>Teachers</h1>
        <SignInGate prompt="Please sign in to manage staff." />
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <span style={iconTile(colors.primary, colors.primaryGhost, 40)}>
          <Users size={20} aria-hidden="true" />
        </span>
        <h1 style={{ ...h1Style, marginBottom: 0 }}>Teachers</h1>
      </div>
      <p style={{ ...mutedStyle, margin: "0 0 20px" }}>
        Staff roster — invite teachers and accountants.
      </p>
      {error ? <p role="alert" style={errorAlert}>{error}</p> : null}
      <div style={{ marginBottom: 16 }}>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <span style={iconTile(colors.primary, colors.primaryGhost, 36)}>
              <UserPlus size={17} aria-hidden="true" />
            </span>
            <h2 style={{ ...h2Style, margin: 0 }}>Invite staff</h2>
          </div>
          <form onSubmit={invite} style={{ display: "grid", gap: 12 }}>
            <div className="sf-form-2col">
              <label style={labelStyle}>
                Full name
                <input
                  className="sf-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={2}
                />
              </label>
              <label style={labelStyle}>
                Email
                <input
                  className="sf-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
            </div>
            <label style={{ ...labelStyle, maxWidth: 280 }}>
              Role
              <select
                className="sf-select"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="TEACHER">Teacher</option>
                <option value="ACCOUNTANT">Accountant</option>
              </select>
            </label>
            <div>
              <button type="submit" disabled={inviting} className="sf-btn sf-btn-primary">
                {inviting ? "Inviting…" : "Invite staff"}
              </button>
            </div>
          </form>
          {inviteResult ? (
            <p style={successNotice}>
              Invited {inviteResult.email} — one-time password:{" "}
              <strong style={{ fontFamily: "monospace" }}>{inviteResult.tempPassword}</strong>{" "}
              (hand it over; it never shows again)
            </p>
          ) : null}
        </Card>
      </div>
      {rows.length === 0 && !loading ? (
        <EmptyState icon={<UserPlus size={22} aria-hidden="true" />} title="No staff yet" detail="Invite your first teacher above." />
      ) : (
        <DataTable
          columns={[
            { key: "name", label: "Name", render: (row: StaffRow) => row.user.name },
            { key: "email", label: "Email", render: (row: StaffRow) => row.user.email },
            {
              key: "role",
              label: "Role",
              render: (row: StaffRow) => (
                <span style={pill(colors.accent, colors.accentTint)}>{row.user.role.name}</span>
              ),
            },
            { key: "designation", label: "Designation", render: (row: StaffRow) => row.designation },
          ]}
          rows={rows}
          rowKey={(row) => row.id}
          sort="name"
          order="asc"
          onSort={() => undefined}
          page={1}
          totalPages={1}
          total={rows.length}
          onPage={() => undefined}
          loading={loading}
          emptyMessage="No staff yet."
        />
      )}
    </main>
  );
}
