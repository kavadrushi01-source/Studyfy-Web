import Link from "next/link";
import {
  ArrowRight,
  Award,
  BarChart3,
  Bell,
  CalendarDays,
  ClipboardCheck,
  FileText,
  GraduationCap,
  MessageCircle,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { colors, gradients, iconTile, pill, primaryBtn, secondaryBtn } from "@/lib/theme";
import { HeroVisual } from "@/components/ui/landing/hero-visual";
import { PublicNav } from "@/components/ui/landing/public-nav";
import { RevealOnScroll } from "@/components/ui/landing/reveal-on-scroll";
import { ShowcaseDisplay } from "@/components/ui/landing/showcase";

// Public marketing site (§7 Phase 1 #10, copy per §8.3; exclusions §8.1:
// no invented customer stats, no app-store badges, no pricing section —
// the product is a portfolio build and tiers are shown inside the app,
// not sold from the landing). The hero visual is dependency-free CSS 3D +
// a tiny particle canvas (§8.5) instead of stock photography.

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

const FACT_PILLS = ["Multi-tenant by design", "8 role dashboards", "9 modules", "PDF receipts & report cards"];

import { LogoMark } from "@/components/ui/logo";

const font: React.CSSProperties = { fontFamily: "Inter, system-ui, sans-serif" };

const accentText: React.CSSProperties = {
  background: gradients.accent,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  WebkitTextFillColor: "transparent",
  color: "transparent",
};

const sectionHead = {
  fontSize: 30,
  fontWeight: 800,
  letterSpacing: "-0.03em",
  textAlign: "center" as const,
  margin: "0 0 8px",
  color: colors.ink,
};

const sectionSub = { textAlign: "center" as const, color: colors.muted, margin: "0 0 28px", fontSize: 15 };

export default function LandingPage() {
  return (
    <div style={{ ...font, color: colors.ink, background: "transparent" }}>
      <PublicNav />

      <main id="top" style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 32px 0" }}>
        {/* Hero — copy + animated 3D visual */}
        <section className="sf-grid-hero" style={{ paddingTop: 40 }}>
          <div>
            <span style={{ ...pill("#2563EB", "#EFF6FF", "#D6E4FF"), fontSize: 12 }}>
              <GraduationCap size={13} aria-hidden="true" /> Built for real schools
            </span>
            <h1 style={{ fontSize: "clamp(34px, 4.8vw, 54px)", lineHeight: 1.08, fontWeight: 800, letterSpacing: "-0.03em", margin: "14px 0 16px", color: colors.ink }}>
              One calm dashboard for{" "}
              <span style={accentText}>your whole school</span>
            </h1>
            <p style={{ fontSize: 17, color: colors.inkSoft, margin: "0 0 8px", lineHeight: 1.6 }}>
              Admissions, attendance, fees, exams, transport, and parent communication — every role gets its own board, and every school gets its own sealed workspace.
            </p>
            <p style={{ fontSize: 14, color: colors.muted, margin: "0 0 24px" }}>
              Start free · 14-day trial, no card needed · Works on any phone browser.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link href="/login" style={{ ...primaryBtn, padding: "12px 24px", textDecoration: "none" }}>Open the live demo</Link>
              <a href="#features" style={{ ...secondaryBtn, padding: "12px 24px", textDecoration: "none" }}>See what&apos;s inside</a>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 24 }}>
              {FACT_PILLS.map((fact) => (
                <span key={fact} style={{ ...pill(colors.muted, "#FFFFFF", colors.line), fontSize: 12 }}>{fact}</span>
              ))}
            </div>
          </div>
          <HeroVisual />
        </section>

        {/* Features */}
        <section id="features" data-reveal style={{ padding: "40px 0 32px" }}>
          <h2 style={sectionHead}>Everything You Need in One Platform</h2>
          <p style={sectionSub}>Nine modules that cover the full school day.</p>
          <div className="sf-grid-3">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <div key={feature.title} className="sf-card sf-land-lean" style={{ padding: 20, position: "relative", overflow: "hidden" }}>
                  <span aria-hidden="true" style={{ position: "absolute", inset: "-1px", borderRadius: 16, padding: "0", background: "linear-gradient(135deg, rgba(37,99,235,.18), rgba(124,58,237,.18) 40%, transparent 70%)", WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)", WebkitMaskComposite: "xor", maskComposite: "exclude", pointerEvents: "none" }} />
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

        {/* Tenant isolation — the honest reason this product is interesting */}
        <section id="tenants" data-reveal style={{ padding: "40px 0", maxWidth: 980, margin: "0 auto" }}>
          <h2 style={sectionHead}>Your School&apos;s Data Stays Yours</h2>
          <p style={sectionSub}>Multi-tenancy isn&apos;t a tagline here — every query is scoped to your school, enforced server-side.</p>
          <div className="sf-grid-1-1" style={{ maxWidth: 980 }}>
            <div className="sf-card" style={{ padding: 22, borderTop: `4px solid #0D9488` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 14px" }}>
                <span style={{ width: 12, height: 12, borderRadius: 999, background: "#0D9488" }} />
                <span style={{ fontWeight: 700, fontSize: 15, color: colors.ink }}>School of Science</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: colors.muted, fontFamily: "monospace" }}>school-of-science</span>
              </div>
              <p style={{ fontSize: 14, color: colors.inkSoft, lineHeight: 1.6, margin: 0 }}>
                Signs in with its own slug. Sees its own students, fees, exams, and audit trail — and nothing from any other school, ever.
              </p>
            </div>
            <div className="sf-card" style={{ padding: 22, borderTop: `4px solid #7F1D1D` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 14px" }}>
                <span style={{ width: 12, height: 12, borderRadius: 999, background: "#7F1D1D" }} />
                <span style={{ fontWeight: 700, fontSize: 15, color: colors.ink }}>Ramakrishna School</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: colors.muted, fontFamily: "monospace" }}>ramakrishna-school</span>
              </div>
              <p style={{ fontSize: 14, color: colors.inkSoft, lineHeight: 1.6, margin: 0 }}>
                Runs a second, completely separate workspace on the same platform. Its data and its plan are invisible to the first school.
              </p>
            </div>
          </div>
          <div className="sf-grid-3" style={{ marginTop: 16 }}>
            {[
              { icon: ShieldCheck, title: "Cross-tenant reads fail closed", detail: "Asking another school's API for a record returns a hard 404 — even with a valid session." },
              { icon: GraduationCap, title: "Everyone gets exactly their board", detail: "Admin, teacher, accountant, librarian, transport, student, parent, owner — role-based, never role-assumed." },
              { icon: ArrowRight, title: "Leave with your data", detail: "Schools can download a GDPR-style ZIP export of everything they own, on demand." },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="sf-card sf-land-lean" style={{ padding: 18 }}>
                  <span style={{ ...iconTile("#7C3AED", "#F5F3FF", 36), margin: "0 0 10px" }}>
                    <Icon size={17} />
                  </span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px", color: colors.ink }}>{item.title}</h3>
                  <p style={{ fontSize: 13.5, color: colors.muted, margin: 0, lineHeight: 1.55 }}>{item.detail}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* How it works */}
        <section data-reveal style={{ padding: "32px 0 40px", maxWidth: 980, margin: "0 auto" }}>
          <h2 style={sectionHead}>From First Enquiry to Report Card</h2>
          <p style={sectionSub}>The whole admission-to-graduation path lives in one system.</p>
          <div className="sf-grid-3">
            {[
              { step: "1", title: "A parent discovers your school", detail: "They fill the public admission enquiry form on your site — name, phone or email, message. The row lands straight in your CRM as New." },
              { step: "2", title: "You convert it to an admission", detail: "Work the enquiry through your stages; when it's Admitted, one click converts it — contact details carried over into the new pupil's profile." },
              { step: "3", title: "School life runs on Studyfy", detail: "Teachers mark attendance and homework, accountants collect fees with PDF receipts, students and parents follow along on their own dashboards." },
            ].map((item) => (
              <div key={item.step} className="sf-card sf-land-lean" style={{ padding: 20 }}>
                <span style={{ display: "inline-flex", width: 34, height: 34, borderRadius: 999, background: gradients.accent, color: "#fff", fontWeight: 800, fontSize: 15, alignItems: "center", justifyContent: "center", margin: "0 0 12px", boxShadow: "0 8px 18px -8px rgba(37,99,235,.65)" }}>
                  {item.step}
                </span>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px", color: colors.ink }}>{item.title}</h3>
                <p style={{ fontSize: 14, color: colors.muted, margin: 0, lineHeight: 1.6 }}>{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Inside the app — one big display, auto-advancing (drive it: dots/arrows/swipe) */}
        <section id="inside" data-reveal style={{ padding: "32px 0 24px" }}>
          <h2 style={{ ...sectionHead, color: colors.ink }}>See It From the Inside</h2>
          <p style={sectionSub}>
            Real screens from the live deployment — it plays on its own; arrows, dots, or a swipe to drive.
          </p>
          <ShowcaseDisplay />
        </section>

        {/* About */}
        <section id="about" data-reveal style={{ padding: "24px 0 8px", maxWidth: 720, margin: "0 auto" }}>
          <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.025em", margin: "0 0 8px", color: colors.ink }}>About Studyfy</h2>
          <p style={{ color: colors.inkSoft, fontSize: 15, lineHeight: 1.65 }}>
            Studyfy is a multi-tenant school management system: each school gets its own isolated workspace with role-based
            dashboards for admins, teachers, accountants, students, parents, and — for school groups — a platform owner view.
            Data is strictly separated per school; parents and students only ever see their own records.
          </p>
        </section>

        {/* Contact */}
        <section id="contact" data-reveal style={{ padding: "32px 0 48px", maxWidth: 720, margin: "0 auto" }}>
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
          <LogoMark size={28} />
          <span style={{ fontWeight: 700, letterSpacing: "-0.02em" }}>Studyfy</span>
        </div>
        <span style={{ fontSize: 13, color: colors.muted }}>Better Schools. Brighter Futures.</span>
        <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
          {["Secure", "Fast", "Scalable", "Multi-Tenant SaaS"].map((badge) => (
            <span key={badge} style={pill(colors.muted, colors.card, colors.line)}>{badge}</span>
          ))}
        </div>
      </footer>

      <RevealOnScroll />
    </div>
  );
}
