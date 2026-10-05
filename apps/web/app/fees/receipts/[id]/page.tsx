"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SkeletonBlocks } from "../../../../components/ui/shell";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, mutedStyle, pageFrame, primaryBtn } from "@/lib/theme";

// Fee receipt viewer (7 Phase 1 #3, print per 8.5). The payment comes from
// the route (/fees/receipts/:id) - no paste box. Fetches the PDF with the
// shared session, opens it in a new tab - the browser's own print dialog
// is the print path (receipts print from the PDF, pixel-faithful).
export default function ReceiptPage() {
  const { token, schoolId, ready, apiFetch } = useAuth();
  const params = useParams<{ id: string }>();
  const paymentId = typeof params.id === "string" ? params.id : "";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function open(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId) {
      setError("Please sign in to open a receipt.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/fees/payments/${paymentId}/receipt`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? `Request failed (${response.status}).`);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      // "noopener" in the features string makes Chrome return null even when
      // the tab DID open (same trap the report-card page already hit): open
      // normally, then sever the opener ourselves.
      const win = window.open(url, "_blank");
      if (win) {
        win.opener = null;
      } else {
        setError("PDF is ready, but the browser blocked the new tab - allow pop-ups for this site and try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Fee Receipt</h1>
        <SkeletonBlocks rows={2} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 8px" }}>Fee Receipt</h1>
        <p style={{ ...mutedStyle, margin: "0 0 12px" }}>Please sign in to open a receipt.</p>
        <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
          Go to login
        </Link>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={{ ...h1Style, margin: "0 0 4px" }}>Fee Receipt</h1>
      <div className="sf-card" style={{ padding: 20, marginTop: 16 }}>
        <form onSubmit={open} style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
          <p style={{ ...mutedStyle, margin: 0, fontSize: 13 }}>
            Opens the PDF for this payment in a new tab — self-scope still applies.
          </p>
          <button
            type="submit"
            disabled={loading}
            style={{ ...primaryBtn, alignSelf: "flex-start", opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "Loading." : "Open receipt PDF"}
          </button>
        </form>
        {error ? (
          <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
