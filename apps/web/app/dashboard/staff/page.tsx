"use client";

// Staff board for LIBRARIAN and TRANSPORT_MANAGER.
//
// Both roles exist in the seed and hold real permissions, but neither has a
// dashboard endpoint: `dashboard/admin` is requirePermission("dashboard.read")
// PLUS requireRole(SCHOOL_ADMIN), so the only way to give these accounts a
// home with the standard sidebar was to build one here from the modules they
// actually run. The API is untouched - this page reads the same library /
// transport endpoints their own module pages already read.
//
// Without it they landed on /library or /transport, which are deliberately
// role-agnostic and render no Shell, so the account had a working page but no
// way to navigate anywhere.

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookMarked, Bus, Users, Wallet } from "lucide-react";
import { Card, Shell, SkeletonBlocks } from "../../../components/ui/shell";
import { boardPathForRole } from "../../../components/ui/role-boards";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, mutedStyle } from "@/lib/theme";
import { isFailure } from "../../../lib/api";

interface StaffStats {
  books: number;
  loans: number;
  routes: number;
  vehicles: number;
  students: number;
}

export default function StaffDashboardPage() {
  const { token, schoolId, user, ready, apiFetch } = useAuth();
  const [stats, setStats] = useState<StaffStats | null>(null);
  const [error, setError] = useState("");

  const role = user?.role === "" ? undefined : user?.role;
  const isLibrarian = role === "LIBRARIAN";
  const isTransport = role === "TRANSPORT_MANAGER";
  const isStaff = isLibrarian || isTransport;

  useEffect(() => {
    if (!ready || !token || !schoolId || !isStaff) {
      return;
    }
    let cancelled = false;
    (async () => {
      const get = async (path: string): Promise<number> => {
        try {
          const res = await apiFetch(path);
          const body = (await res.json()) as { data?: unknown };
          if (isFailure(res, body as { error?: { message?: string } })) {
            return 0;
          }
          const data = body?.data as { items?: unknown[]; total?: number } | unknown[] | undefined;
          if (Array.isArray(data)) {
            return data.length;
          }
          if (Array.isArray(data?.items)) {
            return data.items.length;
          }
          return typeof data?.total === "number" ? data.total : 0;
        } catch {
          return 0;
        }
      };
      // Only request the module this role actually runs; the other would 403.
      const [books, loans, routes, vehicles, students] = isLibrarian
        ? await Promise.all([
            get(`/api/v1/schools/${schoolId}/library/books?page=1&pageSize=100`),
            get(`/api/v1/schools/${schoolId}/library/loans?page=1&pageSize=100`),
            0, 0,
            get(`/api/v1/schools/${schoolId}/students?page=1&pageSize=100`),
          ])
        : await Promise.all([
            0, 0,
            get(`/api/v1/schools/${schoolId}/transport/routes`),
            get(`/api/v1/schools/${schoolId}/transport/vehicles`),
            get(`/api/v1/schools/${schoolId}/students?page=1&pageSize=100`),
          ]);
      if (!cancelled) {
        setStats({ books, loans, routes, vehicles, students });
      }
    })().catch(() => {
      if (!cancelled) {
        setError("Could not load your workspace summary.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ready, token, schoolId, isStaff, isLibrarian, apiFetch]);

  if (!ready) {
    return null;
  }

  if (!role || !boardPathForRole(role)) {
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif", textAlign: "center" }}>
        <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>No board for this account</h1>
        <p style={{ ...mutedStyle, margin: 0 }}>Please sign in to continue.</p>
      </main>
    );
  }

  if (!isStaff) {
    // Not a staff role - send them to the board they own.
    const own = boardPathForRole(role);
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif", textAlign: "center" }}>
        <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>That is not your board</h1>
        <Link href={own as string} style={{ color: colors.primary, fontWeight: 600 }}>
          Go to my board
        </Link>
      </main>
    );
  }

  const tiles = isLibrarian
    ? [
        { label: "Books on shelf", value: stats?.books ?? 0, icon: <BookMarked size={22} />, color: colors.primary, tint: colors.primaryGhost },
        { label: "Open loans", value: stats?.loans ?? 0, icon: <BookMarked size={22} />, color: colors.success, tint: colors.successTint },
        { label: "Students", value: stats?.students ?? 0, icon: <Users size={22} />, color: colors.accent, tint: colors.accentTint },
        { label: "Payroll", value: "-", icon: <Wallet size={22} />, color: colors.warning, tint: colors.warningTint },
      ]
    : [
        { label: "Routes", value: stats?.routes ?? 0, icon: <Bus size={22} />, color: colors.primary, tint: colors.primaryGhost },
        { label: "Vehicles", value: stats?.vehicles ?? 0, icon: <Bus size={22} />, color: colors.success, tint: colors.successTint },
        { label: "Students", value: stats?.students ?? 0, icon: <Users size={22} />, color: colors.accent, tint: colors.accentTint },
        { label: "Payroll", value: "-", icon: <Wallet size={22} />, color: colors.warning, tint: colors.warningTint },
      ];

  return (
    <Shell role={role} activeHref={boardPathForRole(role) as string}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={h1Style}>Welcome, {user?.name ?? ""}</h1>
        <p style={{ ...mutedStyle, margin: "4px 0 0" }}>
          {isLibrarian ? "Library" : "Transport"} workspace · {new Date().toDateString()}
        </p>
      </header>

      {error ? <p style={{ color: colors.danger, fontSize: 14 }}>{error}</p> : null}

      {stats === null ? (
        <SkeletonBlocks rows={2} />
      ) : (
        <section className="sf-grid-kpi" style={{ marginBottom: 20 }}>
          {tiles.map((t) => (
            <Card key={t.label}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: colors.muted }}>{t.label}</span>
                <span style={{ color: t.color, background: t.tint, borderRadius: 10, padding: 8 }}>{t.icon}</span>
              </div>
              <p style={{ fontSize: 26, fontWeight: 700, margin: 0, color: colors.ink }}>{t.value}</p>
            </Card>
          ))}
        </section>
      )}

      <Card>
        <p style={{ ...mutedStyle, margin: 0 }}>
          Use the sidebar to open {isLibrarian ? "Library" : "Transport"}, Students, Payroll and Support.
        </p>
      </Card>
    </Shell>
  );
}
