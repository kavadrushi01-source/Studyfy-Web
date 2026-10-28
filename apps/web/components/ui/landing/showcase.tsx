"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

// "Inside the app" display (§8.3 founder ask, v3): a TABLET-SIZED device —
// smaller than v2, centered with room on each side — that visibly SLIDES
// through real captures of the live deployment (horizontal track, not just
// fades). Under it a filmstrip of the same screenshots auto-scrolls in a
// seamless marquee; tapping a thumb jumps the big screen. Swipe works on
// the tablet; auto-advance pauses on hover/press/focus and while the tab
// is hidden; reduced-motion visitors get manual-only.
const SHOTS: { src: string; url: string; caption: string }[] = [
  { src: "/showcase/admin-dashboard.png", url: "/dashboard", caption: "School Admin · Live overview" },
  { src: "/showcase/students.png", url: "/students", caption: "Student records & documents" },
  { src: "/showcase/fees.png", url: "/fees", caption: "Fees ledger, receipts & TEST MODE pay" },
  { src: "/showcase/attendance.png", url: "/attendance/mark", caption: "Daily attendance marking" },
  { src: "/showcase/timetable.png", url: "/timetable", caption: "Conflict-free auto timetable" },
  { src: "/showcase/library.png", url: "/library", caption: "Library catalog & circulation" },
];

const DWELL_MS = 3800;

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
        className="sf-show-tablet"
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
        <span className="sf-show-cam" aria-hidden="true" />
        <div className="sf-show-screen" aria-live="polite">
          <div className="sf-show-track" style={{ transform: `translateX(-${active * 100}%)` }}>
            {SHOTS.map((shot, index) => (
              <div key={shot.src} className={`sf-show-slide${index === active ? " sf-show-slide-active" : ""}`} aria-hidden={index !== active}>
                <Image
                  src={shot.src}
                  alt={`${shot.caption} — real screen of Studyfy`}
                  width={1280}
                  height={800}
                  priority={index === 0}
                  draggable={false}
                  sizes="640px"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="sf-show-caption">
        <span className="sf-show-url">studyfy-web.vercel.app{SHOTS[active]?.url ?? ""}</span>
        <span className="sf-show-caption-text">{SHOTS[active]?.caption ?? ""}</span>
      </div>

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

      <div className="sf-show-strip" aria-label="More screens">
        <div className="sf-show-strip-track">
          {[...SHOTS, ...SHOTS].map((shot, index) => (
            <button
              key={`${shot.src}-${index}`}
              type="button"
              className={`sf-show-thumb${index % SHOTS.length === active ? " sf-show-thumb-active" : ""}`}
              aria-label={`Show screen: ${shot.caption}`}
              onClick={() => setActive(index % SHOTS.length)}
            >
              <Image src={shot.src} alt="" width={224} height={140} draggable={false} sizes="240px" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}