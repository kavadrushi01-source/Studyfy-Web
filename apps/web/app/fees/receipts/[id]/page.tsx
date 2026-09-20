"use client";

import { useState, type FormEvent } from "react";

// Fee receipt viewer (§7 Phase 1 #3, print per §8.5). Fetches the PDF with
// the pasted staff token, opens it in a new tab — the browser's own print
// dialog is the print path (receipts print from the PDF, pixel-faithful).
// Same token-paste dev workflow as the other pre-dashboard screens.
export default function ReceiptPage() {
  const [schoolId, setSchoolId] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function open(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const response = await fetch(`${api}/api/v1/schools/${schoolId}/fees/payments/${paymentId}/receipt`, {
        headers: { Authorization: `Bearer ${token}` },
      });
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

  return (
    <main style={{ maxWidth: 560, margin: "32px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>Fee Receipt</h1>
      <form onSubmit={open}>
        <label>
          School ID
          <input style={input} value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required />
        </label>
        <label>
          Payment ID
          <input style={input} value={paymentId} onChange={(e) => setPaymentId(e.target.value)} required />
        </label>
        <label>
          Staff bearer token (dev only — login screen replaces this)
          <input style={input} value={token} onChange={(e) => setToken(e.target.value)} required />
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
