"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

// "Inside the app" display (§8.3 founder ask, v5 — gyanmirai style, clean):
// ONE smaller rounded window (no fake browser chrome — the founder wants it
// clean) whose screenshot AUTO-SCROLLS vertically through the whole page —
// the tall full-page captures pan from top to bottom (CSS object-position
// animation, restarted each time a slide becomes active), then the next
// page cross-fades in and scrolls one by one. No dots, no arrows, no strip.
// Auto-advance pauses on hover/press/focus and while the tab is hidden;
// swipe still works; reduced-motion visitors get a static view.
const SHOTS: { src: string; url: string; caption: string }[] = [
  { src: "/showcase/admin-dashboard.png", url: "/dashboard", caption: "School Admin · Live overview" },
  { src: "/showcase/students.png", url: "/students", caption: "Student records & documents" },
  { src: "/showcase/fees.png", url: "/fees", caption: "Fees ledger, receipts & TEST MODE pay" },
  { src: "/showcase/attendance.png", url: "/attendance/mark", caption: "Daily attendance marking" },
  { src: "/showcase/timetable.png", url: "/timetable", caption: "Conflict-free auto timetable" },
  { src: "/showcase/library.png", url: "/library", caption: "Library catalog & circulation" },
];

// One full top→bottom pan per page before the next cross-fades in.
const DWELL_MS = 9000;

export function ShowcaseDisplay(): React.ReactNode {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const swipe = useRef<{ x: number } | null>(null);

  const go = useCallback((delta: number) => {
    setActive((current) => (current + delta + SHOTS.length) % SHOTS.length);
  }, []);

  useEffect(() => {
    const onVisibility = (): void => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (paused || hidden) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timer = window.setInterval(() => go(1), DWELL_MS);
    return () => window.clearInterval(timer);
  }, [paused, hidden, go]);

  return (
    <div
      className="sf-show-stage"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div
        className="sf-show-frame"
        onPointerDown={(e) => {
          swipe.current = { x: e.clientX };
          setPaused(true);
        }}
        onPointerUp={(e) => {
          if (swipe.current && Math.abs(e.clientX - swipe.current.x) > 40) {
            go(e.clientX < swipe.current.x ? 1 : -1);
          }
          swipe.current = null;
        }}
      >
        <div className="sf-show-screen" aria-live="polite">
          {SHOTS.map((shot, index) => (
            <div key={shot.src} className={`sf-show-slide${index === active ? " sf-show-slide-active" : ""}`} aria-hidden={index !== active}>
              <Image
                src={shot.src}
                alt={`${shot.caption} — real screen of Studyfy`}
                width={1920}
                height={1800}
                priority={index === 0}
                draggable={false}
                sizes="800px"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}