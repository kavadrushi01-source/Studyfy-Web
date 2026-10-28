"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { colors, gradients, secondaryBtn } from "@/lib/theme";

// Premium public navbar (§8.3 landing): glass pill with a scroll-spy active
// state and a gentle pressed-state should the header sit over content.
// The links are same-page anchors; smooth scrolling is native CSS
// (scroll-behavior, reduced-motion guarded in globals.css), so no JS
// scroll logic lives here — the observer only picks the ACTIVE link.
const SECTIONS = [
  { id: "top", label: "Home" },
  { id: "features", label: "Features" },
  { id: "tenants", label: "For your school" },
  { id: "inside", label: "Inside" },
  { id: "about", label: "About" },
  { id: "contact", label: "Contact" },
];

export function PublicNav(): React.ReactNode {
  const [active, setActive] = useState("top");
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const onScroll = (): void => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    if (reduced) {
      return () => window.removeEventListener("scroll", onScroll);
    }

    const targets = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    // The section whose top is nearest below the header line wins; when the
    // page bottom is visible the last section wins. Home stays active while
    // above the first real section.
    const onObserve = (): void => {
      const probe = 100;
      let current = "top";
      for (const el of targets) {
        if (el.getBoundingClientRect().top <= probe) {
          current = el.id;
        }
      }
      const atBottom =
        window.innerHeight + Math.ceil(window.scrollY) >= document.body.scrollHeight - 2;
      if (atBottom) {
        current = targets[targets.length - 1]?.id ?? current;
      }
      setActive(current);
    };
    window.addEventListener("scroll", onObserve, { passive: true });
    onObserve();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onObserve);
    };
  }, []);

  const logoTile: React.CSSProperties = {
    width: 32,
    height: 32,
    borderRadius: 10,
    background: gradients.accent,
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    fontSize: 17,
    letterSpacing: "-0.02em",
    boxShadow: "0 6px 18px -6px rgba(37,99,235,.7), inset 0 1px 0 rgba(255,255,255,.25)",
  };

  return (
    <header
      className={`sf-land-header${scrolled ? " sf-land-header-scrolled" : ""}`}
      style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 28px", maxWidth: 1120, margin: "0 auto", borderRadius: 0 }}
    >
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none" }} aria-label="Studyfy home">
        <span style={logoTile}>S</span>
        <span style={{ fontWeight: 700, fontSize: 18, color: colors.ink, letterSpacing: "-0.02em" }}>Studyfy</span>
      </Link>
      <nav className="sf-public-nav" aria-label="Landing" style={{ display: "flex", flex: 1, justifyContent: "center" }}>
        <div className="sf-land-pill">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={`sf-land-pill-link${active === section.id ? " sf-land-pill-active" : ""}`}
              aria-current={active === section.id ? "true" : undefined}
            >
              {section.label}
            </a>
          ))}
        </div>
      </nav>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Link href="/login" style={{ fontSize: 14, color: colors.inkSoft, textDecoration: "none", fontWeight: 600 }}>Login</Link>
        <Link href="/signup" style={{ ...secondaryBtn, textDecoration: "none" }}>Get Started</Link>
      </div>
    </header>
  );
}
