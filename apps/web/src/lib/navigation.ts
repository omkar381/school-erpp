import {
  Award,
  BadgeIndianRupee,
  Building2,
  BookOpen,
  Boxes,
  Bus,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileBarChart,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  MessageSquare,
  PlaneTakeoff,
  Settings,
  ShieldCheck,
  Sparkles,
  UserCog,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Any one of these permissions reveals the item. */
  permissions?: string[];
  /** The item is hidden when the school has this module switched off. */
  module?: string;
  /** Rendered as a count chip; resolved by the shell, not hard-coded. */
  badgeKey?: 'pendingLeave' | 'unreadMessages' | 'openTickets';
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * The sidebar.
 *
 * Grouped by what an administrator is doing rather than by which backend
 * module owns the data — "Fees" and "Payments" are one heading here because
 * they are one job. Every item declares the permission that reveals it; the
 * server still enforces access, this only keeps the sidebar honest.
 */
export const NAVIGATION: NavSection[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'People',
    items: [
      {
        label: 'Admissions',
        href: '/admissions',
        icon: UserPlus,
        permissions: ['admissions.view'],
        module: 'admissions',
      },
      { label: 'Students', href: '/students', icon: GraduationCap, permissions: ['students.view'] },
      { label: 'Parents', href: '/guardians', icon: Users, permissions: ['guardians.view'] },
      { label: 'Staff', href: '/staff', icon: UserCog, permissions: ['staff.view'] },
    ],
  },
  {
    label: 'Academics',
    items: [
      {
        label: 'Attendance',
        href: '/attendance',
        icon: ClipboardCheck,
        permissions: ['attendance.view', 'attendance.mark'],
      },
      {
        label: 'Timetable',
        href: '/timetable',
        icon: CalendarClock,
        permissions: ['timetable.view'],
        module: 'timetable',
      },
      {
        label: 'Homework',
        href: '/homework',
        icon: FileText,
        permissions: ['homework.view'],
        module: 'homework',
      },
      {
        label: 'Assignments',
        href: '/assignments',
        icon: ClipboardList,
        permissions: ['assignments.view'],
        module: 'assignments',
      },
      {
        label: 'Examinations',
        href: '/exams',
        icon: BookOpen,
        permissions: ['exams.view'],
        module: 'exams',
      },
      {
        label: 'Classes & Subjects',
        href: '/academics',
        icon: CalendarDays,
        permissions: ['academics.view', 'classes.view'],
      },
    ],
  },
  {
    label: 'Finance',
    items: [
      {
        label: 'Fees',
        href: '/fees',
        icon: BadgeIndianRupee,
        permissions: ['fees.view'],
        module: 'fees',
      },
      {
        label: 'Pay fees',
        href: '/fees/pay',
        icon: CreditCard,
        permissions: ['self.fees.pay'],
        module: 'payments',
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        label: 'Transport',
        href: '/transport',
        icon: Bus,
        permissions: ['transport.view'],
        module: 'transport',
      },
      {
        label: 'Library',
        href: '/library',
        icon: BookOpen,
        permissions: ['library.view'],
        module: 'library',
      },
      {
        label: 'Inventory',
        href: '/inventory',
        icon: Boxes,
        permissions: ['inventory.view'],
        module: 'inventory',
      },
      {
        label: 'Leave',
        href: '/leave',
        icon: PlaneTakeoff,
        permissions: ['leave.view', 'leave.view.all'],
        badgeKey: 'pendingLeave',
      },
    ],
  },
  {
    label: 'Communication',
    items: [
      { label: 'Notices', href: '/notices', icon: Megaphone, permissions: ['notices.view'] },
      {
        label: 'Messages',
        href: '/messages',
        icon: MessageSquare,
        permissions: ['messages.view'],
        badgeKey: 'unreadMessages',
      },
      { label: 'Events', href: '/events', icon: CalendarDays, permissions: ['events.view'] },
    ],
  },
  {
    label: 'Records',
    items: [
      {
        label: 'Documents',
        href: '/documents',
        icon: FileText,
        permissions: ['documents.view'],
        module: 'documents',
      },
      {
        label: 'Certificates',
        href: '/certificates',
        icon: Award,
        permissions: ['certificates.generate', 'id_cards.generate'],
        module: 'certificates',
      },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Reports', href: '/reports', icon: FileBarChart, permissions: ['reports.view'] },
      { label: 'Audit log', href: '/audit', icon: ShieldCheck, permissions: ['audit_logs.view'] },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Settings', href: '/settings', icon: Settings, permissions: ['school.view', 'school.settings.update', 'roles.view'] },
      {
        label: 'Subscription',
        href: '/settings/subscription',
        icon: CreditCard,
        permissions: ['school.view'],
      },
      { label: 'Support', href: '/support', icon: LifeBuoy, permissions: ['support.tickets.view'] },
    ],
  },
  {
    // Only the super administrator holds `platform.*`, so this whole section
    // is invisible to every school-scoped user. The server enforces it too.
    label: 'Platform',
    items: [
      {
        label: 'Overview',
        href: '/super-admin',
        icon: Sparkles,
        permissions: ['platform.analytics.view'],
      },
      {
        label: 'Schools',
        href: '/super-admin/schools',
        icon: Building2,
        permissions: ['platform.schools.view'],
      },
      {
        label: 'Plans',
        href: '/super-admin/plans',
        icon: BadgeIndianRupee,
        permissions: ['platform.plans.manage'],
      },
      {
        label: 'Subscriptions',
        href: '/super-admin/subscriptions',
        icon: CreditCard,
        permissions: ['platform.subscriptions.manage'],
      },
      {
        label: 'Support desk',
        href: '/super-admin/support',
        icon: LifeBuoy,
        permissions: ['platform.analytics.view'],
        badgeKey: 'openTickets',
      },
    ],
  },
];

/** Human labels for a path segment, used to build breadcrumbs. */
export const ROUTE_LABELS: Record<string, string> = {
  ...Object.fromEntries(
    NAVIGATION.flatMap((section) =>
      section.items.map((item) => [item.href.replace(/^\//, ''), item.label]),
    ),
  ),
  'super-admin': 'Platform',
  schools: 'Schools',
  plans: 'Plans',
  subscriptions: 'Subscriptions',
  subscription: 'Subscription',
};
