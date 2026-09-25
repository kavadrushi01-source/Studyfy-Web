"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { Card, SkeletonBlocks } from "@/components/ui/shell";

const NAVY = "#0F172A";
const TEAL = "#0D9488";
const DANGER = "#DC2626";

const BOARD_BY_ROLE: Record<string, string> = {
  SCHOOL_ADMIN: "/dashboard",
  TEACHER: "/dashboard/teacher",
  ACCOUNTANT: "/dashboard/accountant",
  STUDENT: "/dashboard/student",
  PARENT: "/dashboard/parent",
  PLATFORM_OWNER: "/dashboard/owner",
};

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.ReactNode {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 16,
        padding: "10px 0",
        borderTop: "1px solid #F1F5F9",
        fontSize: 14,
      }}
    >
      <span style={{ color: "#64748B", flexShrink: 0 }}>{label}</span>
      <span style={{ color: NAVY, fontWeight: 600, textAlign: "right", overflowWrap: "anywhere", fontFamily: mono ? "monospace" : undefined }}>
        {value}
      </span>
    </div>
  );
}

// Profile (§8.3): signed-in identity from the shared session. Gated on
// useAuth — skeleton while restoring, sign-in gate when signed out — then a
// neutral teal/grey card with the account rows, board link, and logout.
export default function ProfilePage(): React.ReactNode {
  const { ready, token, user, logout } = useAuth();

  async function handleLogout(): Promise<void> {
    await logout();
    window.location.href = "/login";
  }

  const shell: React.CSSProperties = {
    fontFamily: "Inter, system-ui, sans-serif",
    background: "#F8FAFC",
    minHeight: "100vh",
    padding: 24,
  };
  const inner: React.CSSProperties = { maxWidth: 640, margin: "0 auto" };

  if (!ready) {
    return (
      <main style={shell}>
        <div style={inner}>
          <h1 style={{ fontSize: 24, margin: "0 0 16px", color: NAVY }}>Profile</h1>
          <SkeletonBlocks rows={3} />
        </div>
      </main>
    );
  }

  if (!user || !token) {
    return (
      <main style={shell}>
        <div style={inner}>
          <h1 style={{ fontSize: 24, margin: "0 0 16px", color: NAVY }}>Profile</h1>
          <Card>
            <p style={{ margin: "0 0 12px", fontSize: 14, color: "#475569" }}>You&apos;re signed out.</p>
            <Link
              href="/login"
              style={{
                display: "block",
                textAlign: "center",
                padding: 12,
                borderRadius: 10,
                background: TEAL,
                color: "#fff",
                fontWeight: 600,
                fontSize: 14,
                textDecoration: "none",
              }}
            >
              Sign in
            </Link>
          </Card>
        </div>
      </main>
    );
  }

  const boardHref: string | undefined = BOARD_BY_ROLE[user.role];

  return (
    <main style={shell}>
      <div style={inner}>
        <h1 style={{ fontSize: 24, margin: "0 0 4px", color: NAVY }}>Profile</h1>
        <p style={{ fontSize: 14, color: "#64748B", margin: "0 0 16px" }}>Your signed-in school account</p>
        <Card>
          <div style={{ display: "grid" }}>
            <Row label="Name" value={user.name} />
            <Row label="Email" value={user.email} />
            <Row label="Role" value={user.role.toLowerCase().replace(/_/g, " ")} />
            <Row label="School ID" value={user.schoolId ?? "—"} mono />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            {boardHref ? (
              <Link
                href={boardHref}
                style={{
                  flex: 1,
                  textAlign: "center",
                  padding: 10,
                  borderRadius: 10,
                  background: TEAL,
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: 14,
                  textDecoration: "none",
                }}
              >
                Open my board
              </Link>
            ) : null}
            <button
              type="button"
              onClick={handleLogout}
              style={{
                flex: 1,
                padding: 10,
                borderRadius: 10,
                border: "1px solid #CBD5E1",
                background: "#fff",
                color: DANGER,
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Log out
            </button>
          </div>
        </Card>
      </div>
    </main>
  );
}
