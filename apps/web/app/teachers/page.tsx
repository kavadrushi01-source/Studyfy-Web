"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { DataTable } from "../../components/ui/data-table";
import { EmptyState } from "../../components/ui/shell";
import { isFailure } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

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

  if (!ready) {
    return null;
  }
  if (!token || !schoolId) {
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 22 }}>Teachers</h1>
        <p style={{ color: "#64748B" }}>Please sign in to manage staff.</p>
        <Link href="/login" style={{ color: "#2563EB", fontWeight: 600 }}>Go to Login</Link>
      </main>
    );
  }

  const input: React.CSSProperties = { padding: 10, borderRadius: 10, border: "1px solid #CBD5E1", fontSize: 14 };

  return (
    <main style={{ maxWidth: 1120, margin: "0 auto", padding: 28, fontFamily: "Inter, system-ui, sans-serif", background: "#F8FAFC", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "#0F172A" }}>Teachers</h1>
      <p style={{ color: "#64748B", margin: "0 0 20px", fontSize: 14 }}>Staff roster — invite teachers and accountants.</p>
      {error ? <p style={{ color: "#DC2626", fontSize: 14 }}>{error}</p> : null}
      <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 1px 3px rgba(15,23,42,.08)", padding: 20, marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 12px", color: "#0F172A" }}>Invite staff</h2>
        <form onSubmit={invite} style={{ display: "grid", gap: 12 }}>
          <div className="sf-form-2col">
            <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
              Full name
              <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} style={input} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={input} />
            </label>
          </div>
          <label style={{ display: "grid", gap: 4, fontSize: 14, maxWidth: 280 }}>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value)} style={input}>
              <option value="TEACHER">Teacher</option>
              <option value="ACCOUNTANT">Accountant</option>
            </select>
          </label>
          <div>
            <button type="submit" disabled={inviting} style={{ padding: "11px 22px", borderRadius: 10, border: 0, background: "#2563EB", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
              {inviting ? "Inviting…" : "Invite staff"}
            </button>
          </div>
        </form>
        {inviteResult ? (
          <p style={{ fontSize: 14, color: "#059669", fontWeight: 600, margin: "12px 0 0" }}>
            Invited {inviteResult.email} — one-time password: <strong style={{ fontFamily: "monospace" }}>{inviteResult.tempPassword}</strong> (hand it over; it never shows again)
          </p>
        ) : null}
      </div>
      {rows.length === 0 && !loading ? (
        <EmptyState icon={<UserPlus size={22} aria-hidden="true" />} title="No staff yet" detail="Invite your first teacher above." />
      ) : (
        <DataTable
          columns={[
            { key: "name", label: "Name", render: (row: StaffRow) => row.user.name },
            { key: "email", label: "Email", render: (row: StaffRow) => row.user.email },
            { key: "role", label: "Role", render: (row: StaffRow) => row.user.role.name },
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
