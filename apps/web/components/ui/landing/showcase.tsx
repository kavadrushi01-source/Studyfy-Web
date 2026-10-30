"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Pause, Play, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const SHOTS = [
  { src: "/showcase/admin-dashboard.png", url: "/dashboard", role: "School admin", title: "A clear view of the whole school" },
  { src: "/showcase/students.png", url: "/students", role: "School admin", title: "Student records, all in one place" },
  { src: "/showcase/teacher-board.png", url: "/dashboard/teacher", role: "Teacher", title: "The school day, at a glance" },
  { src: "/showcase/teacher-attendance.png", url: "/attendance/mark", role: "Teacher", title: "Attendance without the busywork" },
  { src: "/showcase/accountant-fees.png", url: "/fees", role: "Accountant", title: "Fees and receipts, together" },
  { src: "/showcase/parent-board.png", url: "/dashboard/parent", role: "Parent", title: "A closer look at your child's day" },
  { src: "/showcase/owner-console.png", url: "/dashboard/owner", role: "Platform owner", title: "Every school, one overview" },
] as const;

const DWELL_MS = 8000;

export function ShowcaseDisplay(): React.ReactNode {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const shot = SHOTS[active];
  if (!shot) {
    throw new Error(`Showcase slide index out of range: ${active}`);
  }

  const go = useCallback((delta: number) => {
    setActive((current) => (current + delta + SHOTS.length) % SHOTS.length);
  }, []);

  useEffect(() => {
    const onVisibility = (): void => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onPreferenceChange = (): void => setReducedMotion(preference.matches);
    onPreferenceChange();
    preference.addEventListener("change", onPreferenceChange);
    return () => preference.removeEventListener("change", onPreferenceChange);
  }, []);

  useEffect(() => {
    if (paused || hidden || reducedMotion) {
      return;
    }
    const timer = window.setTimeout(() => go(1), DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [active, paused, hidden, reducedMotion, go]);

  return (
    <div className={`sf-show-stage${paused || reducedMotion ? " sf-show-paused" : ""}`}>
      <div className="sf-show-heading" aria-live="polite">
        <div className="sf-show-copy">
          <span className="sf-show-eyebrow"><Sparkles size={13} aria-hidden="true" /> A closer look</span>
          <div className="sf-show-title-row">
            <h3 key={shot.title} className="sf-show-title">{shot.title}</h3>
            <span className="sf-show-role">{shot.role}</span>
          </div>
        </div>
        <Link className="sf-show-open" href={shot.url}>
          Explore this screen <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>

      <div className="sf-show-device">
        <div className="sf-show-browser-bar" aria-hidden="true">
          <span className="sf-show-window-dots"><i /><i /><i /></span>
          <span className="sf-show-address"><span /> studyfy.app{shot.url}</span>
          <span className="sf-show-browser-spacer" />
        </div>
        <div
          className="sf-show-screen"
          onPointerDown={(event) => {
            swipe.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={(event) => {
            const start = swipe.current;
            swipe.current = null;
            if (start && Math.abs(event.clientX - start.x) > 48 && Math.abs(event.clientY - start.y) < 70) {
              go(event.clientX < start.x ? 1 : -1);
            }
          }}
          onPointerCancel={() => {
            swipe.current = null;
          }}
        >
          {SHOTS.map((item, index) => (
            <div
              key={item.src}
              className={`sf-show-slide${index === active ? " sf-show-slide-active" : ""}`}
              aria-hidden={index !== active}
            >
              <Image
                src={item.src}
                alt={`${item.role}: ${item.title} — real Studyfy screen`}
                width={1920}
                height={1800}
                priority={index === 0}
                draggable={false}
                sizes="(max-width: 640px) 100vw, 820px"
              />
            </div>
          ))}
          <div className="sf-show-screen-shade" aria-hidden="true" />
        </div>
      </div>

      <div className="sf-show-controls">
        <div className="sf-show-progress" role="group" aria-label="Choose a product screen">
          {SHOTS.map((item, index) => (
            <button
              key={item.src}
              className={`sf-show-progress-item${index === active ? " sf-show-progress-active" : ""}`}
              type="button"
              aria-label={`Show ${item.role}: ${item.title}`}
              aria-current={index === active ? "true" : undefined}
              onClick={() => setActive(index)}
            >
              <span className="sf-show-progress-track">
                <span
                  key={`${index}-${active}-${paused}`}
                  className={index === active ? "sf-show-progress-fill" : ""}
                  style={{ animationDuration: `${DWELL_MS}ms` }}
                />
              </span>
            </button>
          ))}
        </div>
        <div className="sf-show-transport">
          <span className="sf-show-count"><strong>{String(active + 1).padStart(2, "0")}</strong> / {String(SHOTS.length).padStart(2, "0")}</span>
          <div className="sf-show-buttons">
            <button type="button" className="sf-show-control-btn" aria-label="Previous screen" onClick={() => go(-1)}>
              <ArrowLeft size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="sf-show-control-btn sf-show-play-btn"
              aria-label={
                reducedMotion
                  ? "Autoplay disabled by reduced-motion preference"
                  : paused
                    ? "Resume autoplay"
                    : "Pause autoplay"
              }
              disabled={reducedMotion}
              onClick={() => setPaused((value) => !value)}
            >
              {paused ? <Play size={15} fill="currentColor" aria-hidden="true" /> : <Pause size={15} fill="currentColor" aria-hidden="true" />}
            </button>
            <button type="button" className="sf-show-control-btn" aria-label="Next screen" onClick={() => go(1)}>
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
