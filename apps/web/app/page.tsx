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

// Public marketing site (§7 Phase 1 #10, copy per §8.3). Exclusions
// honored (§8.1): no invented customer stats, no app-store badges, and the
// second hero CTA scrolls to features (no demo video exists to "watch").
// No stock photography — the hero visual is a CSS/SVG board mock (§8.5).

const PRIMARY = "#2563EB";
const NAVY = "#0F172A";

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

export default function LandingPage() {
  return (
    <div style={{ ...font, color: NAVY, background: "#fff" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 24, padding: "16px 32px", maxWidth: 1120, margin: "0 auto" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <span style={{ width: 32, height: 32, borderRadius: 9, background: PRIMARY, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18 }}>S</span>
          <span style={{ fontWeight: 700, fontSize: 18, color: NAVY }}>Studyfy</span>
        </Link>
        <nav style={{ display: "flex", gap: 20, flex: 1, justifyContent: "center", fontSize: 14 }}>
          <a href="#top" style={{ color: NAVY, textDecoration: "none" }}>Home</a>
          <a href="#features" style={{ color: NAVY, textDecoration: "none" }}>Features</a>
          <a href="#pricing" style={{ color: NAVY, textDecoration: "none" }}>Pricing</a>
          <a href="#about" style={{ color: NAVY, textDecoration: "none" }}>About</a>
          <a href="#contact" style={{ color: NAVY, textDecoration: "none" }}>Contact</a>
        </nav>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link href="/login" style={{ fontSize: 14, color: NAVY, textDecoration: "none", fontWeight: 600 }}>Login</Link>
          <Link href="/signup" style={{ fontSize: 14, background: PRIMARY, color: "#fff", borderRadius: 10, padding: "10px 18px", textDecoration: "none", fontWeight: 600 }}>Get Started</Link>
        </div>
      </header>

      <main id="top" style={{ maxWidth: 1120, margin: "0 auto", padding: "48px 32px" }}>
        <section className="sf-grid-hero">
          <div>
            <h1 style={{ fontSize: 44, lineHeight: 1.15, margin: "0 0 16px" }}>Modern School Management System for a Brighter Future</h1>
            <p style={{ fontSize: 17, color: "#475569", margin: "0 0 8px" }}>
              Admissions, attendance, fees, exams, and parent communication — one calm dashboard for every role in your school.
            </p>
            <p style={{ fontSize: 14, color: "#64748B", margin: "0 0 24px" }}>
              9 core subjects · Built for any English-medium school · 14-day free trial.
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <Link href="/signup" style={{ background: PRIMARY, color: "#fff", borderRadius: 10, padding: "12px 24px", textDecoration: "none", fontWeight: 600 }}>Get Started Free</Link>
              <a href="#features" style={{ border: "1px solid #CBD5E1", color: NAVY, borderRadius: 10, padding: "12px 24px", textDecoration: "none", fontWeight: 600 }}>See Features</a>
            </div>
          </div>
          <div aria-hidden="true" style={{ background: "#F8FAFC", borderRadius: 16, padding: 24, border: "1px solid #E2E8F0" }}>
            <div style={{ background: NAVY, borderRadius: 10, height: 28, width: "45%", marginBottom: 16 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} style={{ background: "#fff", borderRadius: 10, height: 64, border: "1px solid #E2E8F0" }} />
              ))}
            </div>
            <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #E2E8F0", padding: 12 }}>
              {[85, 60, 72].map((w, i) => (
                <div key={i} style={{ height: 10, borderRadius: 999, background: "#F1F5F9", marginBottom: i === 2 ? 0 : 8 }}>
                  <div style={{ height: "100%", width: `${w}%`, borderRadius: 999, background: PRIMARY }} />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="features" style={{ padding: "32px 0" }}>
          <h2 style={{ fontSize: 30, textAlign: "center", margin: "0 0 8px" }}>Everything You Need in One Platform</h2>
          <p style={{ textAlign: "center", color: "#64748B", margin: "0 0 28px" }}>Nine modules that cover the full school day.</p>
          <div className="sf-grid-3">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
              <div key={feature.title} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: 20, boxShadow: "0 1px 3px rgba(15,23,42,.08)" }}>
                <span style={{ color: PRIMARY, display: "inline-flex", marginBottom: 8 }}>
                  <Icon size={22} />
                </span>
                <h3 style={{ fontSize: 16, margin: "0 0 6px" }}>{feature.title}</h3>
                <p style={{ fontSize: 14, color: "#64748B", margin: 0 }}>{feature.detail}</p>
              </div>
              );
            })}
          </div>
        </section>

        <section id="pricing" style={{ padding: "48px 0" }}>
          <h2 style={{ fontSize: 30, textAlign: "center", margin: "0 0 28px" }}>Simple, Transparent Pricing</h2>
          <div className="sf-grid-3">
            {PLANS.map((plan) => (
              <div key={plan.name} style={{ border: plan.popular ? `2px solid ${PRIMARY}` : "1px solid #E2E8F0", borderRadius: 16, padding: 24, position: "relative", background: "#fff", boxShadow: "0 1px 3px rgba(15,23,42,.08)" }}>
                {plan.popular ? (
                  <span style={{ position: "absolute", top: -12, left: 24, background: PRIMARY, color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "3px 12px" }}>Most Popular</span>
                ) : null}
                <h3 style={{ fontSize: 18, margin: "0 0 4px" }}>{plan.name}</h3>
                <p style={{ fontSize: 24, fontWeight: 800, margin: "0 0 12px" }}>{plan.price}</p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: "#475569", display: "grid", gap: 6 }}>
                  {plan.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p style={{ textAlign: "center", color: "#64748B", fontSize: 14, marginTop: 16 }}>14-day free trial · No setup fee · Cancel anytime.</p>
        </section>

        <section id="about" style={{ padding: "32px 0", maxWidth: 720 }}>
          <h2 style={{ fontSize: 24, margin: "0 0 8px" }}>About Studyfy</h2>
          <p style={{ color: "#475569", fontSize: 15 }}>
            Studyfy is a multi-tenant school management system: each school gets its own isolated workspace with role-based
            dashboards for admins, teachers, accountants, students, parents, and — for school groups — a platform owner view.
            Data is strictly separated per school; parents and students only ever see their own records.
          </p>
        </section>

        <section id="contact" style={{ padding: "32px 0 48px", maxWidth: 720 }}>
          <h2 style={{ fontSize: 24, margin: "0 0 8px" }}>Contact &amp; Admissions</h2>
          <p style={{ color: "#475569", fontSize: 15 }}>
            For admission enquiries, write directly to your school through our{" "}
            <Link href="/enquiry" style={{ color: PRIMARY, fontWeight: 600 }}>admission enquiry form</Link>.
            For everything else — pilots, pricing questions, support — start a free trial and write to us from inside your workspace.
          </p>
          <div style={{ background: "#F8FAFC", borderRadius: 16, border: "1px solid #E2E8F0", padding: 20, marginTop: 16 }}>
            <h3 style={{ fontSize: 16, margin: "0 0 4px" }}>Works great on any phone</h3>
            <p style={{ fontSize: 14, color: "#64748B", margin: 0 }}>
              Every dashboard and form is a responsive web page — open it in any phone browser. No install, no updates, no storage used.
            </p>
          </div>
        </section>
      </main>

      <footer style={{ borderTop: "1px solid #E2E8F0", padding: "28px 32px", maxWidth: 1120, margin: "0 auto", display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: PRIMARY, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>S</span>
          <span style={{ fontWeight: 700 }}>Studyfy</span>
        </div>
        <span style={{ fontSize: 13, color: "#64748B" }}>Better Schools. Brighter Futures.</span>
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          {["Secure", "Fast", "Scalable", "Multi-Tenant SaaS"].map((badge) => (
            <span key={badge} style={{ fontSize: 12, border: "1px solid #E2E8F0", borderRadius: 999, padding: "4px 12px", color: "#475569" }}>{badge}</span>
          ))}
        </div>
      </footer>
    </div>
  );
}
