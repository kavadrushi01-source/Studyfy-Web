"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

// "Inside the app" display (§8.3 founder ask, v6 — gyanmirai style, clean):
// ONE smaller rounded window (no fake browser chrome) that cycles through a
// DIFFERENT ROLE's real page one by one — school admin, teacher, accountant,
// parent, platform owner — each tall full-page capture auto-scrolling from
// top to bottom (CSS object-position animation, restarted per activation),
// then the next role's page cross-fades in. The display NEVER stalls: no
// hover-pause; it only pauses while the visitor is actively pressing/swiping
// or the tab is hidden. Reduced-motion visitors get a static view.
const SHOTS: { src: string; url: string; caption: string }[] = [
  { src: "/showcase/admin-dashboard.png", url: "/dashboard", caption: "School Admin · Live overview" },
  { src: "/showcase/students.png", url: "/students", caption: "School Admin · Student records" },
  { src: "/showcase/teacher-board.png", url: "/dashboard/teacher", caption: "Teacher · My day & classes" },
  { src: "/showcase/teacher-attendance.png", url: "/attendance/mark", caption: "Teacher · Attendance in seconds" },
  { src: "/showcase/accountant-fees.png", url: "/fees", caption: "Accountant · Fees ledger & receipts" },
  { src: "/showcase/parent-board.png", url: "/dashboard/parent", caption: "Parent · Your child's whole day" },
  { src: "/showcase/owner-console.png", url: "/dashboard/owner", caption: "Platform owner · Every school" },
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
          setPaused(false);
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