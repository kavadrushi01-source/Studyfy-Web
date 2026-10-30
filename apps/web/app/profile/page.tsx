"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { SignInLink } from "@/components/ui/sign-in-gate";
import { colors, dangerBtn, gradients, h1Style, mutedStyle, primaryBtn } from "@/lib/theme";
import { Card, SkeletonBlocks } from "@/components/ui/shell";
import { boardPathForRole } from "@/components/ui/role-boards";

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.ReactNode {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 16,
        padding: "12px 0",
        borderTop: `1px solid ${colors.lineSoft}`,
        fontSize: 14,
      }}
    >
      <span style={{ color: colors.muted, flexShrink: 0 }}>{label}</span>
      <span style={{ color: colors.ink, fontWeight: 600, textAlign: "right", overflowWrap: "anywhere", fontFamily: mono ? "monospace" : undefined }}>
        {value}
      </span>
    </div>
  );
}

// Profile (§8.3): signed-in identity from the shared session. Gated on
// useAuth — skeleton while restoring, sign-in gate when signed out — then a
// neutral card with the account rows, board link, and logout.
export default function ProfilePage(): React.ReactNode {
  const router = useRouter();
  const { ready, token, user, apiFetch, logout } = useAuth();
  const [identity, setIdentity] = useState<{
    admissionNo: string | null;
    section: string | null;
    staffId: string | null;
    designation: string | null;
    children: { name: string; section: string }[];
  } | null>(null);

  useEffect(() => {
    if (!ready || !token) {
      return;
    }
    void (async () => {
      try {
        const response = await apiFetch("/api/v1/auth/me");
        const body = (await response.json()) as {
          data?: { identity?: NonNullable<typeof identity> };
        };
        if (response.ok && body.data?.identity) {
          setIdentity(body.data.identity);
        }
      } catch {
        // Non-fatal: the core rows render from the session regardless.
      }
    })();
  }, [ready, token, apiFetch]);

  async function handleLogout(): Promise<void> {
    await logout();
    router.replace("/");
  }

  const shell: React.CSSProperties = {
    fontFamily: "Inter, system-ui, sans-serif",
    background: "transparent",
    minHeight: "100vh",
    padding: "48px 24px 64px",
  };
  const inner: React.CSSProperties = { maxWidth: 640, margin: "0 auto" };

  if (!ready) {
    return (
      <main style={shell}>
        <div style={inner}>
          <h1 style={{ ...h1Style, margin: "0 0 16px" }}>Profile</h1>
          <SkeletonBlocks rows={3} />
        </div>
      </main>
    );
  }

  if (!user || !token) {
    return (
      <main style={shell}>
        <div style={inner}>
          <h1 style={{ ...h1Style, margin: "0 0 16px" }}>Profile</h1>
          <Card>
            <p style={{ margin: "0 0 12px", fontSize: 14, color: colors.muted }}>You&apos;re signed out.</p>
            <SignInLink style={{ ...primaryBtn, display: "block", textAlign: "center", textDecoration: "none" }}>
              Sign in
            </SignInLink>
          </Card>
        </div>
      </main>
    );
  }

  const boardHref = boardPathForRole(user.role) ?? undefined;

  return (
    <main style={shell}>
      <div style={inner}>
        <h1 style={{ ...h1Style, margin: "0 0 4px" }}>Profile</h1>
        <p style={{ ...mutedStyle, margin: "0 0 20px" }}>Your signed-in school account</p>
        <Card>
          <div
            aria-hidden="true"
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: gradients.accent,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 18,
              letterSpacing: "-0.02em",
              margin: "0 0 16px",
              boxShadow: "0 6px 18px -6px rgba(37,99,235,.55), inset 0 1px 0 rgba(255,255,255,.25)",
            }}
          >
            {user.name.trim().charAt(0).toUpperCase()}
          </div>
          <div style={{ display: "grid" }}>
            <Row label="Name" value={user.name} />
            <Row label="Email" value={user.email} />
            <Row label="Role" value={user.role.toLowerCase().replace(/_/g, " ")} />
            <Row label="My ID" value={user.id} mono />
            {identity?.admissionNo ? <Row label="Admission no." value={identity.admissionNo} mono /> : null}
            {identity?.section ? <Row label="Class" value={identity.section} /> : null}
            {identity?.designation ? <Row label="Designation" value={identity.designation} /> : null}
            {identity?.staffId ? <Row label="Staff ID" value={identity.staffId} mono /> : null}
            {identity && identity.children.length > 0 ? (
              <Row
                label={identity.children.length === 1 ? "Child" : "Children"}
                value={identity.children.map((c) => `${c.name} (${c.section})`).join(", ")}
              />
            ) : null}
            <Row label="School ID" value={user.schoolId ?? "—"} mono />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            {boardHref ? (
              <Link href={boardHref} style={{ ...primaryBtn, flex: 1, textAlign: "center", textDecoration: "none" }}>
                Open my board
              </Link>
            ) : null}
            <button type="button" onClick={handleLogout} style={{ ...dangerBtn, flex: 1 }}>
              Log out
            </button>
          </div>
        </Card>
      </div>
    </main>
  );
}
