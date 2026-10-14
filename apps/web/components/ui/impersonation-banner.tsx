"use client";

import { useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";

function roleLabel(role: string): string {
  return role
    .split("_")
    .map((w) => (w ? w[0]?.toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

// Persistent impersonation banner (§13.9): unmissable, on EVERY page while
// impersonating (mounted in Providers, above all content — sticky, so it
// never overlays content and never scrolls away unnoticed). Exit writes
// the END audit event with the owner token, discards the overlay, and
// returns to the owner console. If the END write fails the session is
// still over (the token is discarded client-side) — the failure stays
// visible as an error bar instead of vanishing silently, because a
// missing END row is an audit-integrity problem.
export function ImpersonationBanner(): ReactNode {
  const { impersonation, ready, stopImpersonation } = useAuth();
  const [exiting, setExiting] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);

  if (!ready) {
    return null;
  }

  if (!impersonation) {
    if (!endError) {
      return null;
    }
    return (
      <div role="alert" style={{ background: "#7F1D1D", color: "#fff", padding: "10px 16px", fontSize: 14, fontWeight: 600 }}>
        {endError}{" "}
        <button
          type="button"
          onClick={() => setEndError(null)}
          style={{ marginLeft: 12, background: "transparent", color: "#fff", border: "1px solid #fff", borderRadius: 8, padding: "2px 10px", fontWeight: 700, cursor: "pointer" }}
        >
          Dismiss
        </button>
      </div>
    );
  }

  const ends = new Date(impersonation.expiresAt);
  const endsText = Number.isNaN(ends.getTime())
    ? ""
    : ` · until ${ends.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

  async function exit(): Promise<void> {
    if (exiting) {
      return;
    }
    setExiting(true);
    const problem = await stopImpersonation();
    if (problem) {
      setEndError(problem);
      setExiting(false);
      return;
    }
    window.location.href = "/owner/support";
  }

  return (
    <div
      role="alert"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 60,
        background: "#92400E",
        color: "#fff",
        padding: "10px 16px",
        fontSize: 14,
        fontWeight: 700,
        display: "flex",
        gap: 12,
        alignItems: "center",
        justifyContent: "center",
        flexWrap: "wrap",
      }}
    >
      <span>
        Viewing as {impersonation.target.name} ({roleLabel(impersonation.target.role)}) — read-only{endsText}
      </span>
      <button
        type="button"
        onClick={() => void exit()}
        disabled={exiting}
        style={{
          background: exiting ? "rgba(255,255,255,.4)" : "#fff",
          color: "#92400E",
          border: "none",
          borderRadius: 8,
          padding: "4px 14px",
          fontWeight: 800,
          cursor: exiting ? "wait" : "pointer",
        }}
      >
        {exiting ? "Exiting…" : "Exit"}
      </button>
    </div>
  );
}
