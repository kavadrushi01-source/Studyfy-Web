import type { CSSProperties } from "react";

// Premium style primitives (single source of truth for inline styles —
// the app deliberately uses inline styles, no Tailwind). Pages import from
// here instead of re-declaring local PRIMARY/NAVY/input/button constants so
// every screen shares one elevation, one radius rhythm, one button language.
// Responsive layout still lives in globals.css (.sf-* classes).

export const colors = {
  primary: "#2563EB",
  primaryStrong: "#1D4ED8",
  primaryGhost: "#EFF6FF",
  ink: "#0B1220",
  inkSoft: "#1E293B",
  muted: "#64748B",
  faint: "#94A3B8",
  line: "#E6EBF4",
  lineSoft: "#EFF3F9",
  canvas: "#F5F7FB",
  card: "#FFFFFF",
  success: "#059669",
  successTint: "#ECFDF5",
  warning: "#D97706",
  warningTint: "#FFFBEB",
  danger: "#DC2626",
  dangerTint: "#FEF2F2",
  accent: "#7C3AED",
  accentTint: "#F5F3FF",
} as const;

export const gradients = {
  primary: "linear-gradient(180deg, #3B82F6 0%, #2563EB 100%)",
  sidebar: "linear-gradient(180deg, #0F172A 0%, #0B1220 100%)",
  accent: "linear-gradient(135deg, #2563EB 0%, #7C3AED 100%)",
} as const;

export const shadows = {
  card: "0 1px 2px rgba(15,23,42,.04), 0 8px 24px -16px rgba(15,23,42,.18)",
  cardHover: "0 2px 4px rgba(15,23,42,.05), 0 16px 40px -20px rgba(15,23,42,.28)",
  pop: "0 4px 10px rgba(15,23,42,.06), 0 24px 60px -24px rgba(15,23,42,.35)",
  primary: "0 6px 16px -6px rgba(37,99,235,.55)",
} as const;

/** Standard page frame for Shell-less pages (login, profile, reports…). */
export const pageFrame: CSSProperties = {
  maxWidth: 1120,
  margin: "0 auto",
  padding: 30,
  fontFamily: "Inter, system-ui, sans-serif",
  background: "transparent",
  minHeight: "100vh",
};

/** Card surface — matches .sf-card; use when a div cannot take a class. */
export const cardStyle: CSSProperties = {
  background: colors.card,
  border: `1px solid ${colors.line}`,
  borderRadius: 16,
  boxShadow: shadows.card,
  padding: 20,
};

export const inputStyle: CSSProperties = {
  display: "block",
  width: "100%",
  padding: "10px 12px",
  fontFamily: "inherit",
  fontSize: 14,
  color: colors.ink,
  background: "#fff",
  border: "1px solid #DBE3EF",
  borderRadius: 12,
};

export const labelStyle: CSSProperties = {
  display: "grid",
  gap: 5,
  fontSize: 13,
  fontWeight: 600,
  color: colors.inkSoft,
  letterSpacing: "0.01em",
};

export const h1Style: CSSProperties = {
  fontSize: 26,
  fontWeight: 800,
  margin: 0,
  color: colors.ink,
  letterSpacing: "-0.025em",
};

export const h2Style: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  margin: "0 0 12px",
  color: colors.ink,
  letterSpacing: "-0.015em",
};

export const mutedStyle: CSSProperties = {
  color: colors.muted,
  fontSize: 14,
};

const EASE = "180ms cubic-bezier(.22,1,.36,1)";

/** Primary gradient button (matches .sf-btn-primary). */
export const primaryBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  padding: "10px 18px",
  fontFamily: "inherit",
  fontSize: 14,
  fontWeight: 600,
  color: "#fff",
  background: gradients.primary,
  border: 0,
  borderRadius: 12,
  boxShadow: `inset 0 1px 0 rgba(255,255,255,.18), ${shadows.primary}`,
  cursor: "pointer",
  transition: `transform ${EASE}, box-shadow ${EASE}, background ${EASE}`,
};

export const secondaryBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  padding: "10px 18px",
  fontFamily: "inherit",
  fontSize: 14,
  fontWeight: 600,
  color: colors.inkSoft,
  background: "#fff",
  border: "1px solid #DBE3EF",
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(15,23,42,.05)",
  cursor: "pointer",
  transition: `transform ${EASE}, border-color ${EASE}, background ${EASE}`,
};

export const ghostBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  padding: "9px 14px",
  fontFamily: "inherit",
  fontSize: 14,
  fontWeight: 600,
  color: colors.muted,
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: 12,
  cursor: "pointer",
  transition: `background ${EASE}, color ${EASE}`,
};

export const dangerBtn: CSSProperties = {
  ...secondaryBtn,
  color: colors.danger,
  borderColor: "#FBCFCD",
};

/** Soft tinted status pill (inline tone color + matching tint bg). */
export function pill(tone: string, tint: string, border?: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    color: tone,
    background: tint,
    border: `1px solid ${border ?? tint}`,
    whiteSpace: "nowrap",
  };
}

/** Tinted icon tile (KPI/quick-action glyphs). */
export function iconTile(tone: string, tint: string, size = 40): CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: tint,
    color: tone,
    flexShrink: 0,
  };
}
