import { GraduationCap } from "lucide-react";
import { gradients } from "@/lib/theme";

// The Studyfy mark: a gradient squircle with a graduation cap — one shared
// logo for the nav, app shell, and every auth/standalone page. Size is the
// tile edge; the icon scales with it.
export function LogoMark({ size = 34 }: { size?: number }): React.ReactNode {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        background: gradients.accent,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        boxShadow:
          "0 10px 22px -8px rgba(37, 99, 235, 0.75), inset 0 1px 0 rgba(255, 255, 255, 0.4), inset 0 -3px 8px rgba(15, 23, 42, 0.22)",
      }}
      aria-hidden="true"
    >
      <GraduationCap size={Math.round(size * 0.58)} strokeWidth={2.1} />
    </span>
  );
}