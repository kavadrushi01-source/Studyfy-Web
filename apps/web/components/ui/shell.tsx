"use client";

import { useState, type ReactNode } from "react";
import { Lock, LogOut, Menu, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { gradients, shadows } from "@/lib/theme";
import { NAV_ICONS, ROLE_BOARDS } from "./role-boards";

// Shared dashboard shell (§8.2 + §8.4): icon rail sidebar — every nav entry
// renders as an icon column + tiny label (label stays real text, so
// accessible names and every e2e link-name assertion keep working). Light
// rail per the founder's reference screenshots; active item gets a tinted
// pill + accent rail. Every nav entry is a real page (role-boards.ts
// guarantees it). Collapses to a top strip on narrow screens via .sf-shell
// (§8.5); on phones the rail becomes a horizontal scroll strip.
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
  const { logout } = useAuth();
  // Phones start with the menu collapsed (content first, one tap to
  // navigate); desktops start open. CSS hides the toggle above 900px.
  const [menuOpen, setMenuOpen] = useState(() => (typeof window === "undefined" ? true : window.innerWidth > 900));

  async function handleLogout(): Promise<void> {
    await logout();
    window.location.href = "/login";
  }
  return (
    <div className="sf-shell" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      <aside
        className={`sf-sidebar sf-side-rail${menuOpen ? "" : " sf-side-collapsed"}`}
        style={{
          background: "#FFFFFF",
          color: "#334155",
          borderRight: "1px solid #E6EBF4",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 10px 12px", justifyContent: "center" }}>
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              background: gradients.accent,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 20,
              letterSpacing: "-0.02em",
              flexShrink: 0,
              boxShadow: "0 6px 18px -6px rgba(37,99,235,.7), inset 0 1px 0 rgba(255,255,255,.25)",
            }}
          >
            S
          </span>
          <span
            className="sf-side-brand"
            style={{ fontWeight: 700, fontSize: 18, color: "#0F172A", letterSpacing: "-0.02em" }}
          >
            Studyfy
          </span>
          <button
            type="button"
            className="sf-menu-btn"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            style={{
              alignItems: "center",
              justifyContent: "center",
              width: 40,
              height: 40,
              borderRadius: 10,
              border: "1px solid #E2E8F0",
              background: "#F8FAFC",
              color: "#334155",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
          </button>
        </div>
        <div
          className="sf-side-badge"
          style={{
            margin: "4px auto 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            borderRadius: 999,
            flexShrink: 0,
            background: `linear-gradient(180deg, ${board.badgeBg}1a 0%, ${board.badgeBg}0d 100%)`,
            border: `1px solid ${board.badgeAccent ?? board.badgeBg}44`,
            color: board.badgeAccent ?? board.badgeBg,
          }}
          title={board.badge}
        >
          {board.icon ? <board.icon size={18} aria-hidden="true" /> : null}
        </div>
        <span
          className="sf-side-badge-label"
          style={{
            margin: "-8px auto 14px",
            display: "block",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: board.badgeAccent ?? board.badgeBg,
            maxWidth: 84,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textAlign: "center",
          }}
        >
          {board.badge}
        </span>
        <nav
          className="sf-side-nav"
          aria-label={board.badge}
          style={{ flex: 1, overflowY: "auto", padding: "2px 8px 8px" }}
        >
          {board.nav.map((item) => {
            const active = item.href === activeHref;
            const Icon = NAV_ICONS[item.label];
            return (
              <a
                key={item.label}
                href={item.href}
                className={`sf-rail-item${active ? " sf-rail-active" : ""}`}
                aria-current={active ? "page" : undefined}
                title={item.label}
              >
                {Icon ? (
                  <Icon size={20} strokeWidth={active ? 2.2 : 1.9} aria-hidden="true" />
                ) : null}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                  {item.label}
                </span>
              </a>
            );
          })}
        </nav>
        <button
          type="button"
          className="sf-side-logout sf-rail-item sf-rail-logout"
          onClick={handleLogout}
        >
          <LogOut size={19} aria-hidden="true" />
          <span>Log out</span>
        </button>
      </aside>
      <main className="sf-main" style={{ maxWidth: 1140 }}>
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
        borderRadius: 14,
        padding: "28px 24px",
        textAlign: "center",
        color: "#64748B",
        fontSize: 14,
        display: "grid",
        gap: 8,
        justifyItems: "center",
        background:
          "radial-gradient(400px 120px at 50% 0%, rgba(37,99,235,.05), transparent 70%)",
      }}
    >
      <span
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          background: "#EFF6FF",
          color: "#2563EB",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon}
      </span>
      <span style={{ fontWeight: 600, color: "#1E293B" }}>{title}</span>
      {detail ? <span style={{ maxWidth: 420 }}>{detail}</span> : null}
    </div>
  );
}

// Locked module (§16.1): a gated tier's page stays VISIBLE with an upgrade
// prompt instead of hiding the module or showing a bare error. The message
// is the server's (it names the required tier); the hint sends the reader
// to their administrator. data-testid="module-locked" pins it for e2e.
export function UpgradeLocked({ message }: { message: string }): ReactNode {
  return (
    <div
      data-testid="module-locked"
      style={{
        border: "1px solid rgba(217,119,6,.4)",
        borderRadius: 14,
        padding: "28px 24px",
        textAlign: "center",
        background: "linear-gradient(180deg, rgba(251,191,36,.12), rgba(251,191,36,.03))",
        display: "grid",
        gap: 8,
        justifyItems: "center",
      }}
    >
      <span
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          background: "#FEF3C7",
          color: "#B45309",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Lock size={20} aria-hidden="true" />
      </span>
      <span style={{ fontWeight: 700, fontSize: 16, color: "#92400E" }}>Module locked</span>
      <span style={{ fontSize: 14, color: "#57534E", maxWidth: 440 }}>{message}</span>
      <span style={{ fontSize: 13, color: "#78716C" }}>Contact your school administrator to upgrade.</span>
    </div>
  );
}

// Skeleton blocks (§8.5 — skeletons, never spinners).
export function SkeletonBlocks({ rows = 3, height = 64 }: { rows?: number; height?: number }): ReactNode {
  return (
    <div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="sf-skeleton"
          style={{
            height,
            borderRadius: 14,
            background: "linear-gradient(180deg, #F1F5F9 0%, #E9EFF7 100%)",
            marginBottom: 12,
            border: "1px solid #E6EBF4",
          }}
        />
      ))}
    </div>
  );
}

// Section card + heading shared rhythm (radius 16, padding 20).
// Deliberately NO hover-lift here: Card wraps forms/tables that tests and
// users click through constantly — a transform on hover makes every click
// wait for the element to settle. Lift is opt-in per surface via the
// .sf-card-hover class where nothing interactive is being targeted.
export function Card({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="sf-card" style={{ padding: 20, boxShadow: shadows.card }}>
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }): ReactNode {
  return (
    <h2
      style={{
        fontSize: 16,
        fontWeight: 700,
        letterSpacing: "-0.015em",
        margin: "0 0 12px",
        color: "#0B1220",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 4,
          height: 16,
          borderRadius: 999,
          background: gradients.accent,
        }}
      />
      {children}
    </h2>
  );
}
