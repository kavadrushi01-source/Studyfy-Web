// Canonical role boards config — §8.2 badges + §8.4 nav, single source of
// truth. Every dashboard sidebar renders from here, so nav order, labels,
// badge colors, and role icons can never drift per page. Every nav entry
// points at a real page: unbuilt surfaces are simply absent (a "Soon" pill
// in a shipped portfolio reads as unfinished work, and it used to lie about
// what the role could do).
import {
  Award,
  Bell,
  Banknote,
  BarChart3,
  BookMarked,
  Building,
  Bus,
  CalendarDays,
  ClipboardCheck,
  CreditCard,
  Crown,
  FileBadge,
  GraduationCap,
  LayoutDashboard,
  LayoutGrid,
  LifeBuoy,
  MessageCircle,
  NotebookPen,
  Package,
  PenLine,
  PersonStanding,
  Receipt,
  ScrollText,
  Settings as SettingsIcon,
  Shield,
  User,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
}

export interface RoleBoard {
  badge: string;
  badgeBg: string;
  badgeAccent?: string;
  // §8.2 role icon (component reference, not JSX — this file is .ts).
  icon?: LucideIcon;
  nav: NavItem[];
}

// Icon rail (§8.2 premium pass): every sidebar link renders as an icon +
// tiny label column, matching the reference screenshots the founder approved.
// Keyed by the exact nav label from ROLE_BOARDS, so a renamed label shows a
// fallback icon instead of breaking.
export const NAV_ICONS: Record<string, LucideIcon> = {
  Dashboard: LayoutDashboard,
  Students: Users,
  Teachers: GraduationCap,
  "Classes & Sections": LayoutGrid,
  "Fees & Payments": Wallet,
  "Payments & Receipts": Receipt,
  "Exams & Marks": Award,
  "Marks & Results": Award,
  "Marks Entry": PenLine,
  Admissions: UserPlus,
  Library: BookMarked,
  Certificates: FileBadge,
  Transport: Bus,
  Payroll: Banknote,
  Inventory: Package,
  Reports: BarChart3,
  Billing: CreditCard,
  "Subscriptions & Billing": CreditCard,
  "Audit Logs": ScrollText,
  Support: LifeBuoy,
  "Support & Impersonation": LifeBuoy,
  Settings: SettingsIcon,
  Attendance: ClipboardCheck,
  Homework: NotebookPen,
  Timetable: CalendarDays,
  Messages: MessageCircle,
  Notices: Bell,
  Profile: User,
  Schools: Building,
  "Users Management": Users,
};

export const ROLE_BOARDS: Record<string, RoleBoard> = {
  SCHOOL_ADMIN: {
    badge: "School Admin",
    icon: Crown,
    badgeBg: "#2563EB",
    // Management focus only: attendance, timetable, homework and messaging
    // are the TEACHER's working surfaces (they own the daily workflow), so
    // they are not in the admin nav — the routes still answer for admins,
    // this is a nav cut, not a permission cut.
    nav: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Students", href: "/students" },
      { label: "Teachers", href: "/teachers" },
      { label: "Classes & Sections", href: "/sections" },
      { label: "Fees & Payments", href: "/fees" },
      { label: "Exams & Marks", href: "/exams/results" },
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
    // The daily-teaching board: attendance, marks, homework, timetable,
    // parent/student messaging, school notices. Library and transport
    // reads belong to their owning roles.
    nav: [
      { label: "Dashboard", href: "/dashboard/teacher" },
      { label: "Attendance", href: "/attendance/mark" },
      { label: "Marks Entry", href: "/exams/results" },
      { label: "Homework", href: "/homework" },
      { label: "Timetable", href: "/timetable" },
      { label: "Messages", href: "/messages" },
      { label: "Notices", href: "/notices" },
      { label: "Support", href: "/support" },
      { label: "Profile", href: "/profile" },
    ],
  },
  ACCOUNTANT: {
    badge: "Accountant",
    icon: Wallet,
    badgeBg: "#7C3AED",
    nav: [
      { label: "Dashboard", href: "/dashboard/accountant" },
      { label: "Fees & Payments", href: "/fees" },
      { label: "Payments & Receipts", href: "/fees/payments" },
      { label: "Admissions", href: "/crm" },
      { label: "Certificates", href: "/certificates" },
      { label: "Payroll", href: "/payroll" },
      { label: "Support", href: "/support" },
    ],
  },
  STUDENT: {
    badge: "Student",
    icon: GraduationCap,
    badgeBg: "#0D9488",
    nav: [
      { label: "Dashboard", href: "/dashboard/student" },
      { label: "Marks & Results", href: "/exams/results" },
      { label: "Homework", href: "/homework" },
      { label: "Timetable", href: "/timetable" },
      { label: "Fees & Payments", href: "/fees" },
      { label: "Notices", href: "/notices" },
      { label: "Messages", href: "/messages" },
      { label: "Library", href: "/library" },
      { label: "Transport", href: "/transport" },
      { label: "Profile", href: "/profile" },
    ],
  },
  PARENT: {
    badge: "Parent",
    icon: PersonStanding,
    badgeBg: "#DB2777",
    nav: [
      { label: "Dashboard", href: "/dashboard/parent" },
      { label: "Marks & Results", href: "/exams/results" },
      { label: "Homework", href: "/homework" },
      { label: "Fees & Payments", href: "/fees" },
      { label: "Notices", href: "/notices" },
      { label: "Messages", href: "/messages" },
      { label: "Library", href: "/library" },
      { label: "Transport", href: "/transport" },
      { label: "Profile", href: "/profile" },
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
      { label: "Dashboard", href: "/dashboard/staff" },
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
      { label: "Dashboard", href: "/dashboard/staff" },
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
      { label: "Users Management", href: "/owner/users" },
      { label: "Support & Impersonation", href: "/owner/support" },
      { label: "Audit Logs", href: "/owner/audit-logs" },
      { label: "Settings", href: "/owner/settings" },
    ],
  },
};

// Where each role lands after login, and where the role's "Dashboard" nav
// entry points. Keep this as the single source of truth so every supported
// account reaches its own board and no role is accidentally treated as admin.
export const BOARD_PATH_BY_ROLE: Record<string, string> = {
  SCHOOL_ADMIN: "/dashboard",
  TEACHER: "/dashboard/teacher",
  ACCOUNTANT: "/dashboard/accountant",
  STUDENT: "/dashboard/student",
  PARENT: "/dashboard/parent",
  // No dedicated staff board exists server-side (dashboard/admin is
  // SCHOOL_ADMIN-only), so these roles get the staff board built for them.
  LIBRARIAN: "/dashboard/staff",
  TRANSPORT_MANAGER: "/dashboard/staff",
  PLATFORM_OWNER: "/dashboard/owner",
};

export function boardPathForRole(role: string | undefined | null): string | null {
  if (!role) {
    return null;
  }
  return BOARD_PATH_BY_ROLE[role] ?? null;
}
