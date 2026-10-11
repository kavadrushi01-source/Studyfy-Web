// Canonical role boards config — §8.2 badges + §8.4 nav, single source of
// truth. Every dashboard sidebar renders from here, so nav order, labels,
// badge colors, and "coming soon" treatment can never drift per page.
// href: null = page not built yet → rendered as dimmed text + "Soon" pill,
// never a dead link to a 404.
export interface NavItem {
  label: string;
  href: string | null;
}

export interface RoleBoard {
  badge: string;
  badgeBg: string;
  badgeAccent?: string;
  nav: NavItem[];
}

export const ROLE_BOARDS: Record<string, RoleBoard> = {
  SCHOOL_ADMIN: {
    badge: "School Admin",
    badgeBg: "#2563EB",
    nav: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Students", href: "/students" },
      { label: "Teachers", href: "/teachers" },
      { label: "Classes & Sections", href: "/sections" },
      { label: "Attendance", href: "/attendance/mark" },
      { label: "Fees & Payments", href: "/fees" },
      { label: "Exams & Marks", href: "/exams/results" },
      { label: "Timetable", href: "/timetable" },
      { label: "Homework", href: "/homework" },
      { label: "Communication", href: "/messages" },
      { label: "Admissions", href: "/crm" },
      { label: "Library", href: "/library" },
      { label: "Certificates", href: "/certificates" },
      { label: "Transport", href: "/transport" },
      { label: "Payroll", href: "/payroll" },
      { label: "Inventory", href: "/inventory" },
      { label: "Reports", href: "/analytics" },
      { label: "Audit Logs", href: "/audit-logs" },
      { label: "Settings", href: null },
    ],
  },
  TEACHER: {
    badge: "Teacher",
    badgeBg: "#059669",
    nav: [
      { label: "Dashboard", href: "/dashboard/teacher" },
      { label: "My Classes", href: null },
      { label: "Attendance", href: "/attendance/mark" },
      { label: "Marks Entry", href: "/exams/results" },
      { label: "Homework", href: "/homework" },
      { label: "Timetable", href: "/timetable" },
      { label: "Messages", href: "/messages" },
      { label: "Library", href: "/library" },
      { label: "Transport", href: "/transport" },
      { label: "Resources", href: null },
      { label: "Profile", href: "/profile" },
      { label: "Settings", href: null },
    ],
  },
  ACCOUNTANT: {
    badge: "Accountant",
    badgeBg: "#7C3AED",
    nav: [
      { label: "Dashboard", href: "/dashboard/accountant" },
      { label: "Fees & Payments", href: "/fees" },
      { label: "Invoices", href: "/fees" },
      { label: "Payments & Receipts", href: "/fees/payments" },
      { label: "Admissions", href: "/crm" },
      { label: "Certificates", href: "/certificates" },
      { label: "Payroll", href: "/payroll" },
      { label: "Collection Reports", href: null },
      { label: "Student Fee Ledger", href: null },
      { label: "Reports & Analytics", href: null },
      { label: "Settings", href: null },
    ],
  },
  STUDENT: {
    badge: "Student",
    badgeBg: "#0D9488",
    nav: [
      { label: "Dashboard", href: "/dashboard/student" },
      { label: "Attendance", href: null },
      { label: "Marks & Results", href: "/exams/results" },
      { label: "Homework", href: "/homework" },
      { label: "Timetable", href: "/timetable" },
      { label: "Fees & Payments", href: "/fees" },
      { label: "Notices", href: "/notices" },
      { label: "Messages", href: "/messages" },
      { label: "Library", href: "/library" },
      { label: "Transport", href: "/transport" },
      { label: "Profile", href: "/profile" },
      { label: "Settings", href: null },
    ],
  },
  PARENT: {
    badge: "Parent",
    badgeBg: "#DB2777",
    nav: [
      { label: "Dashboard", href: "/dashboard/parent" },
      { label: "My Children", href: null },
      { label: "Attendance", href: null },
      { label: "Marks & Results", href: "/exams/results" },
      { label: "Homework", href: "/homework" },
      { label: "Fees & Payments", href: "/fees" },
      { label: "Notices", href: "/notices" },
      { label: "Messages", href: "/messages" },
      { label: "Library", href: "/library" },
      { label: "Transport", href: "/transport" },
      { label: "Profile", href: "/profile" },
      { label: "Settings", href: null },
    ],
  },
  PLATFORM_OWNER: {
    badge: "Platform Owner",
    badgeBg: "#0F172A",
    badgeAccent: "#F59E0B",
    nav: [
      { label: "Dashboard", href: "/dashboard/owner" },
      { label: "Schools", href: null },
      { label: "Subscriptions & Billing", href: null },
      { label: "Platform Analytics", href: null },
      { label: "Users Management", href: null },
      { label: "Support & Impersonation", href: null },
      { label: "Audit Logs", href: null },
      { label: "Settings", href: null },
    ],
  },
};
