"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

// "Inside the app" rail (§8.3 founder ask #3): real screenshots of the live
// deployment in a browser-chrome card, on a rail that drifts on its own and
// pauses the moment the visitor grabs it (hover/press/focus) so nothing
// runs away under the cursor. Drag-to-pan is native scroll + pointer
// tracking; auto-drift is a rAF that bounces direction at the rail edges.
// Reduced motion: no drift at all — the rail stays a plain scroller.
const SHOTS: { src: string; url: string; caption: string }[] = [
  { src: "/showcase/admin-dashboard.png", url: "/dashboard", caption: "School Admin · Live overview" },
  { src: "/showcase/students.png", url: "/students", caption: "Student records & documents" },
  { src: "/showcase/fees.png", url: "/fees", caption: "Fees ledger, receipts & TEST MODE pay" },
  { src: "/showcase/attendance.png", url: "/attendance/mark", caption: "Daily attendance marking" },
  { src: "/showcase/timetable.png", url: "/timetable", caption: "Conflict-free auto timetable" },
  { src: "/showcase/library.png", url: "/library", caption: "Library catalog & circulation" },
];

export function ShowcaseRail(): React.ReactNode {
  const railRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const dragRef = useRef<{ startX: number; startLeft: number } | null>(null);
  const driftRef = useRef(0.6);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    let raf = 0;
    const step = (): void => {
      if (!pausedRef.current && !dragRef.current) {
        rail.scrollLeft += driftRef.current;
        const max = rail.scrollWidth - rail.clientWidth;
        if (max > 0) {
          if (rail.scrollLeft >= max - 0.5) {
            driftRef.current = -Math.abs(driftRef.current);
          } else if (rail.scrollLeft <= 0.5) {
            driftRef.current = Math.abs(driftRef.current);
          }
        }
      }
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className="sf-show-rail"
      ref={railRef}
      role="region"
      aria-label="Product screenshots"
      tabIndex={0}
      onPointerEnter={() => {
        pausedRef.current = true;
      }}
      onPointerLeave={() => {
        pausedRef.current = false;
        dragRef.current = null;
      }}
      onPointerDown={(e) => {
        const rail = railRef.current;
        if (!rail) {
          return;
        }
        dragRef.current = { startX: e.clientX, startLeft: rail.scrollLeft };
        rail.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const rail = railRef.current;
        const drag = dragRef.current;
        if (!rail || !drag) {
          return;
        }
        rail.scrollLeft = drag.startLeft - (e.clientX - drag.startX);
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onFocus={() => {
        pausedRef.current = true;
      }}
      onBlur={() => {
        pausedRef.current = false;
      }}
    >
      {SHOTS.map((shot, index) => (
        <figure key={shot.src} className="sf-show-card" style={{ zIndex: index === 0 ? 1 : undefined }}>
          <div className="sf-show-chrome" aria-hidden="true">
            <span className="sf-show-dot" style={{ background: "#FF5F57" }} />
            <span className="sf-show-dot" style={{ background: "#FEBC2E" }} />
            <span className="sf-show-dot" style={{ background: "#28C840" }} />
            <span className="sf-show-url">studyfy-web.vercel.app{shot.url}</span>
          </div>
          <Image
            src={shot.src}
            alt={shot.caption}
            width={1280}
            height={800}
            priority={index === 0}
            draggable={false}
            sizes="640px"
          />
          <figcaption className="sf-show-caption">{shot.caption}</figcaption>
        </figure>
      ))}
    </div>
  );
}
