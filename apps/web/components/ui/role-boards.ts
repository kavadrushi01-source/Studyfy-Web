// Canonical role boards config — §8.2 badges + §8.4 nav, single source of
// truth. Every dashboard sidebar renders from here, so nav order, labels,
// badge colors, role icons, and "coming soon" treatment can never drift per
// page. href: null = page not built yet → rendered as dimmed text + "Soon"
// pill, never a dead link to a 404.
import { BookMarked, Bus, Crown, GraduationCap, PersonStanding, Shield, Wallet, type LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  href: string | null;
}

export interface RoleBoard {
  badge: string;
  badgeBg: string;
  badgeAccent?: string;
  // §8.2 role icon (component reference, not JSX — this file is .ts).
  icon?: LucideIcon;
  nav: NavItem[];
}

export const ROLE_BOARDS: Record<string, RoleBoard> = {
  SCHOOL_ADMIN: {
    badge: "School Admin",
    icon: Crown,
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
      { label: "Billing", href: "/billing" },
      { label: "Audit Logs", href: "/audit-logs" },
      { label: "Support", href: "/support" },
      { label: "Settings", href: "/settings" },
    ],
  },
  TEACHER: {
    badge: "Teacher",
    icon: GraduationCap,
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
      { label: "Support", href: "/support" },
      { label: "Resources", href: null },
      { label: "Profile", href: "/profile" },
      { label: "Settings", href: null },
    ],
  },
  ACCOUNTANT: {
    badge: "Accountant",
    icon: Wallet,
    badgeBg: "#7C3AED",
    nav: [
      { label: "Dashboard", href: "/dashboard/accountant" },
      { label: "Fees & Payments", href: "/fees" },
      { label: "Invoices", href: "/fees" },
      { label: "Payments & Receipts", href: "/fees/payments" },
      { label: "Admissions", href: "/crm" },
      { label: "Certificates", href: "/certificates" },
      { label: "Payroll", href: "/payroll" },
      { label: "Support", href: "/support" },
      { label: "Collection Reports", href: null },
      { label: "Student Fee Ledger", href: null },
      { label: "Reports & Analytics", href: null },
      { label: "Settings", href: null },
    ],
  },
  STUDENT: {
    badge: "Student",
    icon: GraduationCap,
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
    icon: PersonStanding,
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
  // §8.2/§8.4 added these two roles to the seed and the RBAC map but never
  // gave them a board, so Shell fell back to the School Admin board: a
  // librarian/transport manager saw the "School Admin" badge and the full
  // 21-link admin nav, every link but Library/Payroll/Support 403-ing on
  // click. Nav below is exactly what each role's permission keys allow.
  LIBRARIAN: {
    badge: "Librarian",
    icon: BookMarked,
    badgeBg: "#0891B2",
    nav: [
      { label: "Library", href: "/library" },
      { label: "Students", href: "/students" },
      { label: "Payroll", href: "/payroll" },
      { label: "Support", href: "/support" },
      { label: "Profile", href: "/profile" },
    ],
  },
  TRANSPORT_MANAGER: {
    badge: "Transport Manager",
    icon: Bus,
    badgeBg: "#B45309",
    nav: [
      { label: "Transport", href: "/transport" },
      { label: "Students", href: "/students" },
      { label: "Payroll", href: "/payroll" },
      { label: "Support", href: "/support" },
      { label: "Profile", href: "/profile" },
    ],
  },
  PLATFORM_OWNER: {
    badge: "Platform Owner",
    icon: Shield,
    badgeBg: "#0F172A",
    badgeAccent: "#F59E0B",
    nav: [
      { label: "Dashboard", href: "/dashboard/owner" },
      { label: "Schools", href: "/owner/schools" },
      { label: "Subscriptions & Billing", href: "/owner/billing" },
      { label: "Platform Analytics", href: null },
      { label: "Users Management", href: "/owner/users" },
      { label: "Support & Impersonation", href: "/owner/support" },
      { label: "Audit Logs", href: "/owner/audit-logs" },
      { label: "Settings", href: "/owner/settings" },
    ],
  },
};

// Where each role lands after login, and where the role's "Dashboard" nav
// entry points. Single source of truth on purpose: the login screen used to
// carry its own copy, and when a role was missing from it the account logged
// in successfully and was then shown a signed-in screen with no way forward
// (no "Open my board" link, no nav) - a dead end for LIBRARIAN and
// TRANSPORT_MANAGER. Anything absent here has no board and must not pretend
// to be an admin.
export const BOARD_PATH_BY_ROLE: Record<string, string> = {
  SCHOOL_ADMIN: "/dashboard",
  TEACHER: "/dashboard/teacher",
  ACCOUNTANT: "/dashboard/accountant",
  STUDENT: "/dashboard/student",
  PARENT: "/dashboard/parent",
  // No dedicated staff board exists server-side (dashboard/admin is
  // SCHOOL_ADMIN-only), so these roles land on the module they actually run.
  LIBRARIAN: "/library",
  TRANSPORT_MANAGER: "/transport",
  PLATFORM_OWNER: "/dashboard/owner",
};

export function boardPathForRole(role: string | undefined | null): string | null {
  if (!role) {
    return null;
  }
  return BOARD_PATH_BY_ROLE[role] ?? null;
}
