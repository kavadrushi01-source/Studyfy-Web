"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";

// Demo-environment notice (§13.11d): visible on every page for sessions
// inside a demo school — "data resets nightly". Teal and calm (the amber
// impersonation banner owns urgency; the context hides this one while an
// overlay is active). role="status": informative, not an alert.
export function DemoBanner(): ReactNode {
  const { schoolIsDemo, ready } = useAuth();
  if (!ready || !schoolIsDemo) {
    return null;
  }
  return (
    <div
      role="status"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 55,
        background: "#0F766E",
        color: "#fff",
        padding: "8px 16px",
        fontSize: 13,
        fontWeight: 600,
        textAlign: "center",
      }}
    >
      Demo environment — data resets nightly.
    </div>
  );
}
