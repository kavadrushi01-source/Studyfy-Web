"use client";

import { useEffect } from "react";

// Registers the hand-written service worker (public/sw.js) once per client.
// Registration is idempotent across navigations; update flow is the
// browser's default (new worker waits, takes over on next load).
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Offline-first is progressive enhancement — a failed registration
        // must never break the app itself.
      });
    }
  }, []);
  return null;
}
