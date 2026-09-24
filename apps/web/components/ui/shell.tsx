import type { ReactNode } from "react";
import { ROLE_BOARDS } from "./role-boards";

// Shared dashboard shell (§8.2 + §8.4): navy sidebar with logo, role badge,
// canonical nav, and light-canvas content area. Unbuilt destinations render
// as dimmed text with a "Soon" pill — never dead links. Collapses to a top
// strip on narrow screens via .sf-shell (§8.5).
export function Shell({
  role,
  activeHref,
  children,
}: {
  role: keyof typeof ROLE_BOARDS;
  activeHref: string;
  children: ReactNode;
}): ReactNode {
  const board = ROLE_BOARDS[role];
  if (!board) {
    throw new Error(`Unknown role board: ${role}`);
  }
  return (
    <div className="sf-shell" style={{ fontFamily: "Inter, system-ui, sans-serif", background: "#F8FAFC" }}>
      <aside className="sf-sidebar" style={{ background: "#0F172A", color: "#E2E8F0", padding: "20px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 16px" }}>
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "#2563EB",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 20,
            }}
          >
            S
          </span>
          <span style={{ fontWeight: 700, fontSize: 18, color: "#fff" }}>Studyfy</span>
        </div>
        <div
          style={{
            margin: "0 8px 16px",
            display: "inline-block",
            fontSize: 12,
            fontWeight: 600,
            background: board.badgeBg,
            border: board.badgeAccent ? `1px solid ${board.badgeAccent}` : undefined,
            color: board.badgeAccent ?? "#fff",
            borderRadius: 999,
            padding: "4px 12px",
          }}
        >
          {board.badge}
        </div>
        <nav style={{ display: "grid", gap: 2 }}>
          {board.nav.map((item) => {
            const active = item.href === activeHref;
            if (!item.href) {
              return (
                <span
                  key={item.label}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", fontSize: 14, color: "#475569" }}
                >
                  <span style={{ flex: 1 }}>{item.label}</span>
                  <span style={{ fontSize: 11, border: "1px solid #334155", borderRadius: 999, padding: "1px 8px", color: "#94A3B8" }}>
                    Soon
                  </span>
                </span>
              );
            }
            const isOwner = role === "PLATFORM_OWNER";
            return (
              <a
                key={item.label}
                href={item.href}
                style={{
                  display: "block",
                  padding: "9px 12px",
                  borderRadius: 10,
                  fontSize: 14,
                  textDecoration: "none",
                  background: active ? (isOwner ? "#1E293B" : board.badgeBg) : "transparent",
                  borderLeft: active && isOwner ? "3px solid #F59E0B" : "3px solid transparent",
                  color: active ? "#fff" : "#CBD5E1",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      </aside>
      <main className="sf-main" style={{ maxWidth: 1120 }}>
        {children}
      </main>
    </div>
  );
}

// Friendly empty state (§8.5): dashed card with Lucide illustration slot,
// never a blank screen.
export function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail?: string }): ReactNode {
  return (
    <div
      style={{
        border: "1px dashed #CBD5E1",
        borderRadius: 12,
        padding: 24,
        textAlign: "center",
        color: "#64748B",
        fontSize: 14,
        display: "grid",
        gap: 8,
        justifyItems: "center",
      }}
    >
      <span style={{ color: "#94A3B8" }}>{icon}</span>
      <span style={{ fontWeight: 600, color: "#475569" }}>{title}</span>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

// Skeleton blocks (§8.5 — skeletons, never spinners).
export function SkeletonBlocks({ rows = 3, height = 64 }: { rows?: number; height?: number }): ReactNode {
  return (
    <div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sf-skeleton" style={{ height, borderRadius: 14, background: "#F1F5F9", marginBottom: 12 }} />
      ))}
    </div>
  );
}

// Section card + heading shared rhythm (radius 16, padding 20).
export function Card({ children }: { children: ReactNode }): ReactNode {
  return (
    <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 1px 3px rgba(15,23,42,.08)", padding: 20 }}>
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }): ReactNode {
  return <h2 style={{ fontSize: 16, margin: "0 0 12px", color: "#0F172A" }}>{children}</h2>;
}
