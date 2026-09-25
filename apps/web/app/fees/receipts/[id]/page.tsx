"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { SkeletonBlocks } from "../../../../components/ui/shell";
import { useAuth } from "@/lib/auth-context";

// Fee receipt viewer (§7 Phase 1 #3, print per §8.5). Fetches the PDF with
// the shared session, opens it in a new tab — the browser's own print
// dialog is the print path (receipts print from the PDF, pixel-faithful).
export default function ReceiptPage() {
  const { token, schoolId, ready, apiFetch } = useAuth();
  const [paymentId, setPaymentId] = useState("");
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
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }

  const input = { display: "block", width: "100%", margin: "4px 0 12px", padding: 8 } as const;
  const frame = { maxWidth: 560, margin: "32px auto", padding: 16, fontFamily: "system-ui, sans-serif" } as const;

  if (!ready) {
    return (
      <main style={frame}>
        <h1>Fee Receipt</h1>
        <SkeletonBlocks rows={2} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={frame}>
        <h1>Fee Receipt</h1>
        <p>Please sign in to open a receipt.</p>
        <Link href="/login" style={{ color: "#2563EB", fontWeight: 600 }}>
          Go to login
        </Link>
      </main>
    );
  }

  return (
    <main style={frame}>
      <h1>Fee Receipt</h1>
      <form onSubmit={open}>
        <label>
          Payment ID
          <input style={input} value={paymentId} onChange={(e) => setPaymentId(e.target.value)} required />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? "Loading…" : "Open receipt PDF"}
        </button>
      </form>
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
