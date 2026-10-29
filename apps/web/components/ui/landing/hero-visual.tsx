"use client";

import { useEffect, useRef } from "react";
import { BookOpen, Bus, ClipboardCheck, Wallet } from "lucide-react";
import { colors, gradients, iconTile } from "@/lib/theme";

// Landing hero visual (§8.3/§8.5): a mouse-tilted 3D mock of the product
// built from plain CSS transforms, over a tiny canvas particle field.
// Zero dependencies, respects prefers-reduced-motion (CSS side) and pauses
// the canvas when the tab is hidden — both for battery and smoothness.
// aria-hidden: it is decor, not data; §8.1 bans invented real-looking
// product stats, so the mock carries bars and labels only, no KPI numbers.

interface Particle {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  hue: number;
}

function useParticleCanvas(): React.RefObject<HTMLCanvasElement | null> {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const parent = canvas.parentElement;
    if (!parent) {
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const particles: Particle[] = [];
    let raf = 0;
    let running = true;
    let width = 0;
    let height = 0;

    const seed = (): void => {
      width = parent.clientWidth;
      height = parent.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles.length = 0;
      const count = Math.min(64, Math.max(28, Math.round((width * height) / 26000)));
      for (let i = 0; i < count; i += 1) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          r: 1 + Math.random() * 2.2,
          vx: (Math.random() - 0.5) * 0.22,
          vy: -0.12 - Math.random() * 0.3,
          hue: Math.random() > 0.5 ? 221 : 262,
        });
      }
    };

    const frame = (): void => {
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -8) {
          p.y = height + 8;
          p.x = Math.random() * width;
        }
        if (p.x < -8) {
          p.x = width + 8;
        }
        if (p.x > width + 8) {
          p.x = -8;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 84%, 60%, 0.20)`;
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };

    const setRunning = (on: boolean): void => {
      if (on && !running) {
        running = true;
        raf = requestAnimationFrame(frame);
      } else if (!on && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    };

    const onVisibility = (): void => {
      setRunning(!document.hidden && inView);
    };

    let inView = true;
    const io = new IntersectionObserver((entries) => {
      inView = entries[0]?.isIntersecting ?? true;
      setRunning(inView && !document.hidden);
    });
    io.observe(parent);

    seed();
    raf = requestAnimationFrame(frame);
    const observer = new ResizeObserver(seed);
    observer.observe(parent);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return canvasRef;
}

export function HeroVisual(): React.ReactNode {
  const canvasRef = useParticleCanvas();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const motionOk = useRef(true);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.innerWidth <= 560) {
      motionOk.current = false;
    }
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !motionOk.current) {
      return;
    }
    let frame = 0;
    let targetX = 0;
    let targetY = 0;
    const onMove = (event: MouseEvent): void => {
      const rect = stage.getBoundingClientRect();
      const relX = (event.clientX - rect.left) / rect.width - 0.5;
      const relY = (event.clientY - rect.top) / rect.height - 0.5;
      targetX = Math.max(-1, Math.min(1, relX * 2));
      targetY = Math.max(-1, Math.min(1, relY * 2));
      if (!frame) {
        frame = requestAnimationFrame(apply);
      }
    };
    const onLeave = (): void => {
      targetX = 0;
      targetY = 0;
      if (!frame) {
        frame = requestAnimationFrame(apply);
      }
    };
    const apply = (): void => {
      frame = 0;
      stage.style.transform = `rotateY(${targetX * 7}deg) rotateX(${targetY * -6}deg)`;
    };
    const wrap = stage.parentElement;
    wrap?.addEventListener("mousemove", onMove);
    wrap?.addEventListener("mouseleave", onLeave);
    return () => {
      wrap?.removeEventListener("mousemove", onMove);
      wrap?.removeEventListener("mouseleave", onLeave);
      if (frame) {
        cancelAnimationFrame(frame);
      }
    };
  }, []);

  const bar = (w: number, tint: string): React.ReactNode => (
    <div style={{ height: 8, borderRadius: 999, background: "#EDF2FB", overflow: "hidden" }}>
      <div style={{ width: `${w}%`, height: "100%", borderRadius: 999, background: tint }} />
    </div>
  );

  return (
    <div style={{ position: "relative", minHeight: 380 }} aria-hidden="true">
      <div
        className="sf-land-blob"
        style={{ width: 300, height: 300, top: -40, right: -60, background: "radial-gradient(circle, rgba(37,99,235,.55), transparent 65%)", animationDelay: "-4s" }}
      />
      <div
        className="sf-land-blob"
        style={{ width: 260, height: 260, bottom: -30, left: -50, background: "radial-gradient(circle, rgba(124,58,237,.5), transparent 65%)", animationDelay: "-11s" }}
      />
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, zIndex: 0 }} />
      <div className="sf-land-perspective" style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 380, padding: "28px 8px" }}>
        <div ref={stageRef} className="sf-land-tilt" style={{ position: "relative", width: 300, height: 300, transformStyle: "preserve-3d" }}>
          {/* Back card — fees */}
          <div
            className="sf-land-float"
            style={{
              position: "absolute",
              inset: "0 auto auto 0",
              width: 260,
              padding: 16,
              borderRadius: 18,
              background: "rgba(255,255,255,.85)",
              border: "1px solid rgba(230,235,244,.9)",
              boxShadow: "0 30px 60px -30px rgba(15,23,42,.35)",
              transform: "translate3d(-34px, 8px, -70px) rotateY(10deg)",
              animationDelay: "-2.2s",
              display: "grid",
              gap: 10,
            }}
          >
            <span style={{ ...iconTile(colors.primary, colors.primaryGhost, 34) }}>
              <Wallet size={16} />
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: colors.ink }}>Fees</span>
            {bar(78, gradients.primary)}
            {bar(46, "#C7D6F5")}
            <span style={{ fontSize: 11, color: colors.muted }}>Invoices · receipts · payroll</span>
          </div>
          {/* Mid card — attendance */}
          <div
            className="sf-land-float"
            style={{
              position: "absolute",
              inset: "0 auto auto 50%",
              width: 260,
              marginLeft: -170,
              marginTop: 64,
              padding: 16,
              borderRadius: 18,
              background: "rgba(255,255,255,.94)",
              border: "1px solid rgba(230,235,244,.95)",
              boxShadow: "0 40px 80px -40px rgba(15,23,42,.4)",
              transform: "translateZ(10px)",
              animationDelay: "-0.6s",
              display: "grid",
              gap: 10,
            }}
          >
            <span style={{ ...iconTile("#059669", "#ECFDF5", 34) }}>
              <ClipboardCheck size={16} />
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: colors.ink }}>Attendance</span>
            {bar(88, "linear-gradient(180deg,#34d399 0%,#059669 100%)")}
            {bar(64, "#C7F0E2")}
            <span style={{ fontSize: 11, color: colors.muted }}>Mark → summary → alerts</span>
          </div>
          {/* Front toast — homework */}
          <div
            className="sf-land-float"
            style={{
              position: "absolute",
              bottom: 4,
              right: -18,
              width: 210,
              padding: "12px 14px",
              borderRadius: 16,
              background: "linear-gradient(135deg,#2563eb 0%,#7c3aed 100%)",
              color: "#fff",
              boxShadow: "0 34px 60px -24px rgba(37,99,235,.65)",
              transform: "translateZ(70px) rotateY(-8deg)",
              animationDelay: "-3.4s",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <BookOpen size={18} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.35 }}>
              Homework collected
              <span style={{ display: "block", opacity: 0.75, fontWeight: 500 }}>graded in one pass</span>
            </span>
          </div>
          {/* Route chip — transport */}
          <div
            className="sf-land-float"
            style={{
              position: "absolute",
              top: -12,
              right: -8,
              padding: "8px 12px",
              borderRadius: 999,
              background: "rgba(255,255,255,.92)",
              border: "1px solid rgba(230,235,244,.95)",
              boxShadow: "0 18px 36px -18px rgba(15,23,42,.35)",
              transform: "translateZ(30px)",
              animationDelay: "-4.8s",
              display: "flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            <Bus size={14} color="#B45309" />
            <span style={{ fontSize: 11, fontWeight: 700, color: colors.ink }}>Routes &amp; riders</span>
          </div>
        </div>
      </div>
    </div>
  );
}
