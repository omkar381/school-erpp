/**
 * Feature modules that can be switched on or off per school (by the school's
 * subscription plan, and then further by the school admin).
 */
export const MODULES = {
  CORE: 'core',
  STUDENTS: 'students',
  STAFF: 'staff',
  ATTENDANCE: 'attendance',
  TIMETABLE: 'timetable',
  HOMEWORK: 'homework',
  ASSIGNMENTS: 'assignments',
  EXAMS: 'exams',
  REPORT_CARDS: 'report_cards',
  FEES: 'fees',
  PAYMENTS: 'payments',
  COMMUNICATION: 'communication',
  CHAT: 'chat',
  LEAVE: 'leave',
  EVENTS: 'events',
  TRANSPORT: 'transport',
  LIBRARY: 'library',
  INVENTORY: 'inventory',
  HR: 'hr',
  PAYROLL: 'payroll',
  ADMISSIONS: 'admissions',
  DOCUMENTS: 'documents',
  CERTIFICATES: 'certificates',
  ID_CARDS: 'id_cards',
  REPORTS: 'reports',
  ANALYTICS: 'analytics',
  WEBSITE: 'website',
  SUPPORT: 'support',
} as const;

export type ModuleKey = (typeof MODULES)[keyof typeof MODULES];

export const ALL_MODULES: ModuleKey[] = Object.values(MODULES);

/** Modules that are always available and cannot be disabled. */
export const CORE_MODULES: ModuleKey[] = [
  MODULES.CORE,
  MODULES.STUDENTS,
  MODULES.STAFF,
  MODULES.ATTENDANCE,
  MODULES.COMMUNICATION,
  MODULES.DOCUMENTS,
];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  core: 'Core',
  students: 'Student Management',
  staff: 'Staff Management',
  attendance: 'Attendance',
  timetable: 'Timetable',
  homework: 'Homework',
  assignments: 'Assignments',
  exams: 'Examinations',
  report_cards: 'Report Cards',
  fees: 'Fee Management',
  payments: 'Online Payments',
  communication: 'Communication',
  chat: 'Messaging',
  leave: 'Leave Management',
  events: 'Events',
  transport: 'Transport',
  library: 'Library',
  inventory: 'Inventory',
  hr: 'Human Resources',
  payroll: 'Payroll',
  admissions: 'Admissions',
  documents: 'Documents',
  certificates: 'Certificates',
  id_cards: 'ID Cards',
  reports: 'Reports',
  analytics: 'Analytics',
  website: 'Public Website',
  support: 'Support Desk',
};

export const PLAN_MODULES: Record<'BASIC' | 'PROFESSIONAL' | 'ENTERPRISE', ModuleKey[]> = {
  BASIC: [
    ...CORE_MODULES,
    MODULES.TIMETABLE,
    MODULES.HOMEWORK,
    MODULES.EXAMS,
    MODULES.FEES,
    MODULES.REPORTS,
  ],
  PROFESSIONAL: [
    ...CORE_MODULES,
    MODULES.TIMETABLE,
    MODULES.HOMEWORK,
    MODULES.ASSIGNMENTS,
    MODULES.EXAMS,
    MODULES.REPORT_CARDS,
    MODULES.FEES,
    MODULES.PAYMENTS,
    MODULES.CHAT,
    MODULES.LEAVE,
    MODULES.EVENTS,
    MODULES.LIBRARY,
    MODULES.TRANSPORT,
    MODULES.ADMISSIONS,
    MODULES.CERTIFICATES,
    MODULES.ID_CARDS,
    MODULES.REPORTS,
    MODULES.ANALYTICS,
    MODULES.SUPPORT,
  ],
  ENTERPRISE: ALL_MODULES,
};
