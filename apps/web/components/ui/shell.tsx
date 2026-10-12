"use client";

import { useState, type ReactNode } from "react";
import { Lock, LogOut, Menu, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { gradients, shadows } from "@/lib/theme";
import { ROLE_BOARDS } from "./role-boards";

// Shared dashboard shell (§8.2 + §8.4): navy sidebar with logo, role badge,
// canonical nav, and light-canvas content area. Unbuilt destinations render
// as dimmed text with a "Soon" pill — never dead links. Collapses to a top
// strip on narrow screens via .sf-shell (§8.5). Premium pass: layered
// gradient sidebar, glass active states with accent rail, micro-motion.
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
  const transition = "180ms cubic-bezier(.22,1,.36,1)";
  return (
    <div className="sf-shell" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      <aside
        className={`sf-sidebar${menuOpen ? "" : " sf-side-collapsed"}`}
        style={{
          background: gradients.sidebar,
          color: "#E2E8F0",
          padding: "20px 14px",
          borderRight: "1px solid rgba(148,163,184,.12)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "0 8px 18px" }}>
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
              boxShadow: "0 6px 18px -6px rgba(37,99,235,.7), inset 0 1px 0 rgba(255,255,255,.25)",
            }}
          >
            S
          </span>
          <span style={{ fontWeight: 700, fontSize: 18, color: "#fff", letterSpacing: "-0.02em", flex: 1 }}>
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
              border: "1px solid rgba(148,163,184,.25)",
              background: "rgba(255,255,255,.06)",
              color: "#E2E8F0",
              cursor: "pointer",
            }}
          >
            {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
          </button>
        </div>
        <div
          style={{
            margin: "0 8px 18px",
            display: "inline-block",
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            background: board.badgeAccent
              ? `linear-gradient(180deg, ${board.badgeBg}33 0%, ${board.badgeBg}1f 100%)`
              : "rgba(255,255,255,.08)",
            border: board.badgeAccent
              ? `1px solid ${board.badgeAccent}55`
              : "1px solid rgba(255,255,255,.14)",
            color: board.badgeAccent ?? "#E2E8F0",
            borderRadius: 999,
            padding: "5px 12px",
            width: "fit-content",
          }}
        >
          {board.badge}
        </div>
        <nav className="sf-side-nav" style={{ display: "grid", gap: 3, flex: 1 }}>
          {board.nav.map((item) => {
            const active = item.href === activeHref;
            if (!item.href) {
              return (
                <span
                  key={item.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "9px 12px",
                    fontSize: 14,
                    color: "#3E4C63",
                  }}
                >
                  <span style={{ flex: 1 }}>{item.label}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      border: "1px solid rgba(148,163,184,.25)",
                      borderRadius: 999,
                      padding: "1px 8px",
                      color: "#5B6B85",
                    }}
                  >
                    Soon
                  </span>
                </span>
              );
            }
            const isOwner = role === "PLATFORM_OWNER";
            const accent = isOwner ? "#F59E0B" : (board.badgeAccent ?? "#60A5FA");
            return (
              <a
                key={item.label}
                href={item.href}
                style={{
                  display: "block",
                  position: "relative",
                  padding: "9px 12px 9px 14px",
                  borderRadius: 10,
                  fontSize: 14,
                  textDecoration: "none",
                  background: active ? "rgba(255,255,255,.09)" : "transparent",
                  border: active ? "1px solid rgba(255,255,255,.1)" : "1px solid transparent",
                  color: active ? "#fff" : "#B6C2D6",
                  fontWeight: active ? 600 : 500,
                  transition: `background ${transition}, color ${transition}, border-color ${transition}`,
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = "rgba(255,255,255,.05)";
                    e.currentTarget.style.color = "#E8EEF9";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "#B6C2D6";
                  }
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: -14,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 3,
                    height: active ? 18 : 0,
                    borderRadius: 999,
                    background: accent,
                    boxShadow: active ? `0 0 10px ${accent}` : "none",
                    transition: `height ${transition}`,
                  }}
                />
                {item.label}
              </a>
            );
          })}
        </nav>
        <button
          type="button"
          className="sf-side-logout"
          onClick={handleLogout}
          style={{
            marginTop: 16,
            width: "100%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(148,163,184,.22)",
            background: "rgba(255,255,255,.03)",
            color: "#B6C2D6",
            fontFamily: "inherit",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            transition: `background 180ms cubic-bezier(.22,1,.36,1), color 180ms cubic-bezier(.22,1,.36,1), border-color 180ms cubic-bezier(.22,1,.36,1)`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(239,68,68,.14)";
            e.currentTarget.style.color = "#FECACA";
            e.currentTarget.style.borderColor = "rgba(239,68,68,.35)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,.03)";
            e.currentTarget.style.color = "#B6C2D6";
            e.currentTarget.style.borderColor = "rgba(148,163,184,.22)";
          }}
        >
          <LogOut size={15} aria-hidden="true" />
          Log out
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
