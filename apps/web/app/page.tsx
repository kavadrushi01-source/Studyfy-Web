import Link from "next/link";
import {
  Award,
  BarChart3,
  Bell,
  CalendarDays,
  ClipboardCheck,
  FileText,
  MessageCircle,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { colors, gradients, iconTile, pill, primaryBtn, secondaryBtn, shadows } from "@/lib/theme";

// Public marketing site (§7 Phase 1 #10, copy per §8.3). Exclusions
// honored (§8.1): no invented customer stats, no app-store badges, and the
// second hero CTA scrolls to features (no demo video exists to "watch").
// No stock photography — the hero visual is a CSS/SVG board mock (§8.5).

const FEATURES: { title: string; detail: string; icon: LucideIcon }[] = [
  { title: "Student Management", detail: "Admissions, profiles, documents, and printable ID cards.", icon: Users },
  { title: "Attendance", detail: "Daily marking with monthly summaries and absentee email alerts.", icon: ClipboardCheck },
  { title: "Fees & Payments", detail: "Structures, invoices, counter collections, and PDF receipts.", icon: Wallet },
  { title: "Exams & Marks", detail: "Schedules, bulk marks entry, auto grades, ranks, and report cards.", icon: Award },
  { title: "Timetable", detail: "Conflict-free auto-generated weekly timetables.", icon: CalendarDays },
  { title: "Homework", detail: "Post assignments, collect submissions, grade them.", icon: FileText },
  { title: "Notices", detail: "School, class, and section announcements with email delivery.", icon: Bell },
  { title: "Parent Communication", detail: "Scoped 1:1 teacher–parent messaging with admin oversight.", icon: MessageCircle },
  { title: "Reports & Analytics", detail: "Role dashboards with live KPIs for every stakeholder.", icon: BarChart3 },
];

const PLANS: { name: string; price: string; popular: boolean; points: string[] }[] = [
  {
    name: "Basic",
    price: "₹2,999/month",
    popular: false,
    points: ["Up to 500 students", "Core features", "Email support"],
  },
  {
    name: "Standard",
    price: "₹5,999/month",
    popular: true,
    points: ["Up to 1,500 students", "All core features", "Priority support"],
  },
  {
    name: "Premium",
    price: "₹9,999/month",
    popular: false,
    points: ["Unlimited students", "Advanced features", "24/7 support"],
  },
];

const font: React.CSSProperties = { fontFamily: "Inter, system-ui, sans-serif" };

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

const accentText: React.CSSProperties = {
  background: gradients.accent,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  WebkitTextFillColor: "transparent",
  color: "transparent",
};

export default function LandingPage() {
  return (
    <div style={{ ...font, color: colors.ink, background: "transparent" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 24, padding: "16px 32px", maxWidth: 1120, margin: "0 auto" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none" }}>
          <span style={logoTile}>S</span>
          <span style={{ fontWeight: 700, fontSize: 18, color: colors.ink, letterSpacing: "-0.02em" }}>Studyfy</span>
        </Link>
        <nav style={{ display: "flex", gap: 20, flex: 1, justifyContent: "center", fontSize: 14 }}>
          <a href="#top" style={{ color: colors.inkSoft, textDecoration: "none", fontWeight: 500 }}>Home</a>
          <a href="#features" style={{ color: colors.inkSoft, textDecoration: "none", fontWeight: 500 }}>Features</a>
          <a href="#pricing" style={{ color: colors.inkSoft, textDecoration: "none", fontWeight: 500 }}>Pricing</a>
          <a href="#about" style={{ color: colors.inkSoft, textDecoration: "none", fontWeight: 500 }}>About</a>
          <a href="#contact" style={{ color: colors.inkSoft, textDecoration: "none", fontWeight: 500 }}>Contact</a>
        </nav>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link href="/login" style={{ fontSize: 14, color: colors.inkSoft, textDecoration: "none", fontWeight: 600 }}>Login</Link>
          <Link href="/signup" style={{ ...secondaryBtn, textDecoration: "none" }}>Get Started</Link>
        </div>
      </header>

      <main id="top" style={{ maxWidth: 1120, margin: "0 auto", padding: "48px 32px" }}>
        <section className="sf-grid-hero">
          <div>
            <h1 style={{ fontSize: "clamp(34px, 4.8vw, 54px)", lineHeight: 1.08, fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 16px", color: colors.ink }}>
              Modern School Management System for a{" "}
              <span style={accentText}>Brighter Future</span>
            </h1>
            <p style={{ fontSize: 17, color: colors.inkSoft, margin: "0 0 8px", lineHeight: 1.6 }}>
              Admissions, attendance, fees, exams, and parent communication — one calm dashboard for every role in your school.
            </p>
            <p style={{ fontSize: 14, color: colors.muted, margin: "0 0 24px" }}>
              9 core subjects · Built for any English-medium school · 14-day free trial.
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <Link href="/signup" style={{ ...primaryBtn, padding: "12px 24px", textDecoration: "none" }}>Get Started Free</Link>
              <a href="#features" style={{ ...secondaryBtn, padding: "12px 24px", textDecoration: "none" }}>See Features</a>
            </div>
          </div>
          <div aria-hidden="true" style={{ background: colors.card, borderRadius: 16, padding: 24, border: `1px solid ${colors.line}`, boxShadow: shadows.card }}>
            <div style={{ background: gradients.accent, borderRadius: 10, height: 28, width: "45%", marginBottom: 16 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} style={{ background: colors.canvas, borderRadius: 10, height: 64, border: `1px solid ${colors.line}` }} />
              ))}
            </div>
            <div style={{ background: colors.canvas, borderRadius: 10, border: `1px solid ${colors.line}`, padding: 12 }}>
              {[85, 60, 72].map((w, i) => (
                <div key={i} style={{ height: 10, borderRadius: 999, background: "#E2E8F0", marginBottom: i === 2 ? 0 : 8 }}>
                  <div style={{ height: "100%", width: `${w}%`, borderRadius: 999, background: gradients.primary }} />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="features" style={{ padding: "32px 0" }}>
          <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.03em", textAlign: "center", margin: "0 0 8px", color: colors.ink }}>Everything You Need in One Platform</h2>
          <p style={{ textAlign: "center", color: colors.muted, margin: "0 0 28px" }}>Nine modules that cover the full school day.</p>
          <div className="sf-grid-3">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
              <div key={feature.title} className="sf-card sf-card-hover" style={{ padding: 20 }}>
                <span style={{ ...iconTile(colors.primary, colors.primaryGhost, 40), margin: "0 0 12px" }}>
                  <Icon size={20} />
                </span>
                <h3 style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.015em", margin: "0 0 6px", color: colors.ink }}>{feature.title}</h3>
                <p style={{ fontSize: 14, color: colors.muted, margin: 0 }}>{feature.detail}</p>
              </div>
              );
            })}
          </div>
        </section>

        <section id="pricing" style={{ padding: "48px 0" }}>
          <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.03em", textAlign: "center", margin: "0 0 28px", color: colors.ink }}>Simple, Transparent Pricing</h2>
          <div className="sf-grid-3">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className="sf-card sf-card-hover"
                style={{ padding: 24, position: "relative", ...(plan.popular ? { border: `2px solid ${colors.primary}` } : null) }}
              >
                {plan.popular ? (
                  <span style={{ position: "absolute", top: -12, left: 24, background: gradients.accent, color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "3px 12px", boxShadow: "0 6px 16px -8px rgba(37,99,235,.7)" }}>Most Popular</span>
                ) : null}
                <h3 style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 4px", color: colors.ink }}>{plan.name}</h3>
                <p style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 12px", color: colors.ink }}>{plan.price}</p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: colors.inkSoft, display: "grid", gap: 6 }}>
                  {plan.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p style={{ textAlign: "center", color: colors.muted, fontSize: 14, marginTop: 16 }}>14-day free trial · No setup fee · Cancel anytime.</p>
        </section>

        <section id="about" style={{ padding: "32px 0", maxWidth: 720 }}>
          <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.025em", margin: "0 0 8px", color: colors.ink }}>About Studyfy</h2>
          <p style={{ color: colors.inkSoft, fontSize: 15, lineHeight: 1.65 }}>
            Studyfy is a multi-tenant school management system: each school gets its own isolated workspace with role-based
            dashboards for admins, teachers, accountants, students, parents, and — for school groups — a platform owner view.
            Data is strictly separated per school; parents and students only ever see their own records.
          </p>
        </section>

        <section id="contact" style={{ padding: "32px 0 48px", maxWidth: 720 }}>
          <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.025em", margin: "0 0 8px", color: colors.ink }}>Contact &amp; Admissions</h2>
          <p style={{ color: colors.inkSoft, fontSize: 15, lineHeight: 1.65 }}>
            For admission enquiries, write directly to your school through our{" "}
            <Link href="/enquiry" style={{ color: colors.primary, fontWeight: 600 }}>admission enquiry form</Link>.
            For everything else — pilots, pricing questions, support — start a free trial and write to us from inside your workspace.
          </p>
          <div className="sf-card" style={{ padding: 20, marginTop: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.015em", margin: "0 0 4px", color: colors.ink }}>Works great on any phone</h3>
            <p style={{ fontSize: 14, color: colors.muted, margin: 0 }}>
              Every dashboard and form is a responsive web page — open it in any phone browser. No install, no updates, no storage used.
            </p>
          </div>
        </section>
      </main>

      <footer style={{ borderTop: `1px solid ${colors.line}`, padding: "28px 32px", maxWidth: 1120, margin: "0 auto", display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...logoTile, width: 28, height: 28, borderRadius: 8, fontSize: 15 }}>S</span>
          <span style={{ fontWeight: 700, letterSpacing: "-0.02em" }}>Studyfy</span>
        </div>
        <span style={{ fontSize: 13, color: colors.muted }}>Better Schools. Brighter Futures.</span>
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          {["Secure", "Fast", "Scalable", "Multi-Tenant SaaS"].map((badge) => (
            <span key={badge} style={pill(colors.muted, colors.card, colors.line)}>{badge}</span>
          ))}
        </div>
      </footer>
    </div>
  );
}
