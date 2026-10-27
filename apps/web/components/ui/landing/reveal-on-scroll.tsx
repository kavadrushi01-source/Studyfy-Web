"use client";

import { useEffect } from "react";

// Reveal-on-scroll for the landing sections: a server component pins
// data-reveal attributes, this null-rendering client component picks them
// up on mount and only then enables the hidden/translated state — pages
// load completely functional without JS, and the animation is a quiet
// upgrade, not a gateway. prefers-reduced-motion skips observation
// entirely (each [data-reveal] just gets the final class).
export function RevealOnScroll(): null {
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (targets.length === 0) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      targets.forEach((el) => el.classList.add("sf-reveal-in"));
      return;
    }
    targets.forEach((el) => el.classList.add("sf-reveal"));
    // Anything already inside the viewport (hero, above-the-fold cards)
    // shows immediately instead of waiting one observer cycle — no blink.
    const insideNow = (): void => {
      for (const el of targets) {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
          el.classList.add("sf-reveal-in");
          observer.unobserve(el);
        }
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("sf-reveal-in");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -80px 0px", threshold: 0.08 },
    );
    targets.forEach((el) => {
      if (!el.classList.contains("sf-reveal-in")) {
        observer.observe(el);
      }
    });
    insideNow();
    return () => observer.disconnect();
  }, []);
  return null;
}
