import Link from "next/link";

const SCREENS: { href: string; title: string; detail: string }[] = [
  { href: "/students", title: "Students", detail: "Teacher-scoped sortable roster with search and pages." },
  { href: "/students/new", title: "Admit Student", detail: "New admission with guardian linking and one-time passwords." },
  { href: "/students/abc", title: "Student Profile", detail: "Self-scoped record - replace abc with a real student ID." },
  { href: "/students/abc/id-card", title: "ID Card - Print", detail: "CR80 print card for a student ID." },
  {
    href: "/students/abc/report",
    title: "Report Card",
    detail: "Opens the exam report PDF - needs school, exam, and student IDs.",
  },
  { href: "/sections", title: "Classes & Sections", detail: "Class-teacher assignment per section." },
  { href: "/attendance/mark", title: "Mark Attendance", detail: "Roster toggles with one save action." },
  { href: "/fees", title: "Fees & Payments", detail: "Ledger with status pills and totals." },
  { href: "/fees/receipts/abc", title: "Fee Receipt", detail: "Opens a payment receipt PDF - replace abc with a payment ID." },
  { href: "/notices", title: "Notice Board", detail: "Publish and read school/class/section notices." },
  { href: "/exams/results", title: "Exam Results", detail: "Ranked board with optional top-K and grade pills." },
  { href: "/dashboard", title: "School Admin Dashboard", detail: "KPIs, growth chart, activities, quick actions." },
  { href: "/dashboard/teacher", title: "Teacher Dashboard", detail: "Today view: classes, attendance, pending, messages." },
  { href: "/dashboard/accountant", title: "Accountant Dashboard", detail: "Collection, trend, donut, transactions." },
  { href: "/dashboard/student", title: "Student Dashboard", detail: "Attendance, marks, dues, timetable." },
  { href: "/dashboard/parent", title: "Parent Dashboard", detail: "Child selector, progress, notices." },
  { href: "/dashboard/owner", title: "Platform Dashboard", detail: "Schools table, analytics (owner token, no slug)." },
];

// Dev index — moved off / when the public marketing site landed (Chunk 5).
// Not linked from anywhere public; local development convenience only.
export default function DevIndex() {
  return (
    <main style={{ maxWidth: 900, margin: "32px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>Studyfy — dev index</h1>
      <p>Development index - every screen below takes a pasted bearer token until login lands.</p>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {SCREENS.map((screen) => (
          <li
            key={screen.href}
            style={{
              background: "#fff",
              borderRadius: 14,
              boxShadow: "0 1px 3px rgba(15,23,42,.08)",
              padding: 16,
              marginBottom: 12,
            }}
          >
            <Link href={screen.href} style={{ color: "#2563EB", fontWeight: 700, fontSize: 16 }}>
              {screen.title}
            </Link>
            <p style={{ margin: "4px 0 0", color: "#64748B", fontSize: 14 }}>{screen.detail}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
