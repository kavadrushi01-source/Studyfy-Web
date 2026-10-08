import Link from "next/link";

// Offline fallback shell (§7 Phase 3 #20): served by the service worker
// when a navigation has no network and no cached copy. Static and
// self-contained by design — no data fetching, so it renders with zero
// connectivity. Writes (marking, payments) stay online-only.
export default function OfflinePage() {
  return (
    <main
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "64px 28px",
        fontFamily: "Inter, system-ui, sans-serif",
        textAlign: "center",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          background: "#0F172A",
          color: "#fff",
          fontSize: 32,
          fontWeight: 800,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 20px",
        }}
      >
        S
      </div>
      <h1 style={{ fontSize: 24, color: "#0F172A", margin: "0 0 8px" }}>You are offline</h1>
      <p style={{ fontSize: 14, color: "#64748B", margin: "0 0 20px" }}>
        Studyfy needs a connection to load fresh data. Pages you already visited are kept on this device and open
        normally — everything else waits here until you are back.
      </p>
      <Link
        href="/"
        style={{
          display: "inline-block",
          background: "#2563EB",
          color: "#fff",
          fontWeight: 600,
          fontSize: 14,
          padding: "10px 20px",
          borderRadius: 10,
          textDecoration: "none",
        }}
      >
        Try again
      </Link>
    </main>
  );
}
