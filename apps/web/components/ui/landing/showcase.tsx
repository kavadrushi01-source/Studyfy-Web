"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

// "Inside the app" display (§8.3 founder ask): ONE large premium screen —
// a dark stage with a big mac-chrome window — that auto-advances through
// real captures of the live deployment. The visitor can drive it: dots,
// prev/next arrows, swipe. Auto-advance pauses on hover/press/focus and
// while the tab is hidden; reduced-motion visitors get manual-only.
const SHOTS: { src: string; url: string; caption: string }[] = [
  { src: "/showcase/admin-dashboard.png", url: "/dashboard", caption: "School Admin · Live overview" },
  { src: "/showcase/students.png", url: "/students", caption: "Student records & documents" },
  { src: "/showcase/fees.png", url: "/fees", caption: "Fees ledger, receipts & TEST MODE pay" },
  { src: "/showcase/attendance.png", url: "/attendance/mark", caption: "Daily attendance marking" },
  { src: "/showcase/timetable.png", url: "/timetable", caption: "Conflict-free auto timetable" },
  { src: "/showcase/library.png", url: "/library", caption: "Library catalog & circulation" },
];

const DWELL_MS = 4200;

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
        <div className="sf-show-chrome" aria-hidden="true">
          <span className="sf-show-dot" style={{ background: "#FF5F57" }} />
          <span className="sf-show-dot" style={{ background: "#FEBC2E" }} />
          <span className="sf-show-dot" style={{ background: "#28C840" }} />
          <span className="sf-show-url">studyfy-web.vercel.app{SHOTS[active]?.url ?? ""}</span>
        </div>
        <div className="sf-show-screen" aria-live="polite">
          {SHOTS.map((shot, index) => (
            <div key={shot.src} className={`sf-show-slide${index === active ? " sf-show-slide-active" : ""}`} aria-hidden={index !== active}>
              <Image
                src={shot.src}
                alt={`${shot.caption} — real screen of Studyfy`}
                width={1280}
                height={800}
                priority={index === 0}
                draggable={false}
                sizes="1080px"
              />
            </div>
          ))}
          <div className="sf-show-caption">{SHOTS[active]?.caption ?? ""}</div>
        </div>
      </div>

      <div className="sf-show-controls">
        <button type="button" className="sf-show-arrow" aria-label="Previous screen" onClick={() => go(-1)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="sf-show-dots" role="tablist" aria-label="Screens">
          {SHOTS.map((shot, index) => (
            <button
              key={shot.src}
              type="button"
              role="tab"
              aria-selected={index === active}
              aria-label={`Show screen ${index + 1}: ${shot.caption}`}
              className={`sf-show-dot-btn${index === active ? " sf-show-dot-active" : ""}`}
              onClick={() => setActive(index)}
            />
          ))}
        </div>
        <button type="button" className="sf-show-arrow" aria-label="Next screen" onClick={() => go(1)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
