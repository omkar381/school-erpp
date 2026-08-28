import { RoleType } from '@prisma/client';

/**
 * The complete permission catalogue. Every guarded endpoint references one of
 * these keys; the seeder mirrors this list into the `permissions` table so that
 * school admins can compose custom role grants from it.
 */
export const PERMISSIONS = {
  // --- Platform (super admin only) ---
  PLATFORM_SCHOOLS_VIEW: 'platform.schools.view',
  PLATFORM_SCHOOLS_CREATE: 'platform.schools.create',
  PLATFORM_SCHOOLS_UPDATE: 'platform.schools.update',
  PLATFORM_SCHOOLS_SUSPEND: 'platform.schools.suspend',
  PLATFORM_SCHOOLS_DELETE: 'platform.schools.delete',
  PLATFORM_PLANS_MANAGE: 'platform.plans.manage',
  PLATFORM_SUBSCRIPTIONS_MANAGE: 'platform.subscriptions.manage',
  PLATFORM_ANALYTICS_VIEW: 'platform.analytics.view',
  PLATFORM_HEALTH_VIEW: 'platform.health.view',
  PLATFORM_IMPERSONATE: 'platform.impersonate',
  PLATFORM_SETTINGS_MANAGE: 'platform.settings.manage',

  // --- School configuration ---
  SCHOOL_VIEW: 'school.view',
  SCHOOL_UPDATE: 'school.update',
  SCHOOL_BRANDING_UPDATE: 'school.branding.update',
  SCHOOL_SETTINGS_UPDATE: 'school.settings.update',
  SCHOOL_MODULES_MANAGE: 'school.modules.manage',

  // --- Users, roles, permissions ---
  USERS_VIEW: 'users.view',
  USERS_CREATE: 'users.create',
  USERS_UPDATE: 'users.update',
  USERS_DELETE: 'users.delete',
  USERS_RESET_PASSWORD: 'users.reset_password',
  ROLES_VIEW: 'roles.view',
  ROLES_CREATE: 'roles.create',
  ROLES_UPDATE: 'roles.update',
  ROLES_DELETE: 'roles.delete',
  PERMISSIONS_ASSIGN: 'permissions.assign',

  // --- Academic structure ---
  ACADEMIC_YEARS_VIEW: 'academic_years.view',
  ACADEMIC_YEARS_MANAGE: 'academic_years.manage',
  CLASSES_VIEW: 'classes.view',
  CLASSES_MANAGE: 'classes.manage',
  SECTIONS_VIEW: 'sections.view',
  SECTIONS_MANAGE: 'sections.manage',
  SUBJECTS_VIEW: 'subjects.view',
  SUBJECTS_MANAGE: 'subjects.manage',
  DEPARTMENTS_VIEW: 'departments.view',
  DEPARTMENTS_MANAGE: 'departments.manage',
  ROOMS_MANAGE: 'rooms.manage',
  CALENDAR_MANAGE: 'calendar.manage',

  // --- Students ---
  STUDENTS_VIEW: 'students.view',
  STUDENTS_VIEW_ALL: 'students.view_all',
  STUDENTS_CREATE: 'students.create',
  STUDENTS_UPDATE: 'students.update',
  STUDENTS_DELETE: 'students.delete',
  STUDENTS_IMPORT: 'students.import',
  STUDENTS_EXPORT: 'students.export',
  STUDENTS_PROMOTE: 'students.promote',
  STUDENTS_TRANSFER: 'students.transfer',
  STUDENTS_DOCUMENTS_MANAGE: 'students.documents.manage',

  // --- Guardians ---
  GUARDIANS_VIEW: 'guardians.view',
  GUARDIANS_CREATE: 'guardians.create',
  GUARDIANS_UPDATE: 'guardians.update',
  GUARDIANS_DELETE: 'guardians.delete',

  // --- Staff / HR ---
  STAFF_VIEW: 'staff.view',
  STAFF_CREATE: 'staff.create',
  STAFF_UPDATE: 'staff.update',
  STAFF_DELETE: 'staff.delete',
  STAFF_EXPORT: 'staff.export',
  STAFF_DOCUMENTS_MANAGE: 'staff.documents.manage',
  PAYROLL_VIEW: 'payroll.view',
  PAYROLL_MANAGE: 'payroll.manage',

  // --- Attendance ---
  ATTENDANCE_VIEW: 'attendance.view',
  ATTENDANCE_VIEW_ALL: 'attendance.view_all',
  ATTENDANCE_MARK: 'attendance.mark',
  ATTENDANCE_EDIT: 'attendance.edit',
  ATTENDANCE_DELETE: 'attendance.delete',
  ATTENDANCE_REPORTS: 'attendance.reports',
  STAFF_ATTENDANCE_VIEW: 'staff_attendance.view',
  STAFF_ATTENDANCE_MARK: 'staff_attendance.mark',
  STAFF_ATTENDANCE_EDIT: 'staff_attendance.edit',

  // --- Timetable ---
  TIMETABLE_VIEW: 'timetable.view',
  TIMETABLE_MANAGE: 'timetable.manage',
  TIMETABLE_SUBSTITUTE: 'timetable.substitute',

  // --- Homework & assignments ---
  HOMEWORK_VIEW: 'homework.view',
  HOMEWORK_CREATE: 'homework.create',
  HOMEWORK_UPDATE: 'homework.update',
  HOMEWORK_DELETE: 'homework.delete',
  HOMEWORK_SUBMIT: 'homework.submit',
  HOMEWORK_REVIEW: 'homework.review',
  ASSIGNMENTS_VIEW: 'assignments.view',
  ASSIGNMENTS_CREATE: 'assignments.create',
  ASSIGNMENTS_UPDATE: 'assignments.update',
  ASSIGNMENTS_DELETE: 'assignments.delete',
  ASSIGNMENTS_SUBMIT: 'assignments.submit',
  ASSIGNMENTS_GRADE: 'assignments.grade',

  // --- Examinations ---
  EXAMS_VIEW: 'exams.view',
  EXAMS_CREATE: 'exams.create',
  EXAMS_UPDATE: 'exams.update',
  EXAMS_DELETE: 'exams.delete',
  EXAMS_SCHEDULE: 'exams.schedule',
  EXAMS_ENTER_MARKS: 'exams.enter_marks',
  EXAMS_EDIT_LOCKED_MARKS: 'exams.edit_locked_marks',
  EXAMS_PUBLISH_RESULTS: 'exams.publish_results',
  GRADES_MANAGE: 'grades.manage',
  REPORT_CARDS_VIEW: 'report_cards.view',
  REPORT_CARDS_GENERATE: 'report_cards.generate',
  REPORT_CARDS_PUBLISH: 'report_cards.publish',

  // --- Fees & finance ---
  FEES_VIEW: 'fees.view',
  FEES_STRUCTURE_MANAGE: 'fees.structure.manage',
  FEES_INVOICE_CREATE: 'fees.invoice.create',
  FEES_INVOICE_CANCEL: 'fees.invoice.cancel',
  FEES_COLLECT: 'fees.collect',
  FEES_REFUND: 'fees.refund',
  FEES_DISCOUNT_MANAGE: 'fees.discount.manage',
  FEES_DISCOUNT_APPROVE: 'fees.discount.approve',
  FEES_REPORTS: 'fees.reports',
  FEES_EXPORT: 'fees.export',
  FINANCE_DASHBOARD_VIEW: 'finance.dashboard.view',

  // --- Communication ---
  NOTICES_VIEW: 'notices.view',
  NOTICES_CREATE: 'notices.create',
  NOTICES_UPDATE: 'notices.update',
  NOTICES_DELETE: 'notices.delete',
  NOTICES_PUBLISH: 'notices.publish',
  COMMUNICATION_SEND: 'communication.send',
  COMMUNICATION_BROADCAST: 'communication.broadcast',
  MESSAGES_VIEW: 'messages.view',
  MESSAGES_SEND: 'messages.send',
  MESSAGES_MODERATE: 'messages.moderate',

  // --- Leave ---
  LEAVE_VIEW: 'leave.view',
  LEAVE_VIEW_ALL: 'leave.view_all',
  LEAVE_APPLY: 'leave.apply',
  LEAVE_APPROVE: 'leave.approve',
  LEAVE_TYPES_MANAGE: 'leave.types.manage',

  // --- Events ---
  EVENTS_VIEW: 'events.view',
  EVENTS_CREATE: 'events.create',
  EVENTS_UPDATE: 'events.update',
  EVENTS_DELETE: 'events.delete',

  // --- Transport ---
  TRANSPORT_VIEW: 'transport.view',
  TRANSPORT_MANAGE: 'transport.manage',
  TRANSPORT_ASSIGN: 'transport.assign',
  TRANSPORT_TRACK: 'transport.track',

  // --- Library ---
  LIBRARY_VIEW: 'library.view',
  LIBRARY_MANAGE: 'library.manage',
  LIBRARY_ISSUE: 'library.issue',
  LIBRARY_RETURN: 'library.return',
  LIBRARY_FINE_MANAGE: 'library.fine.manage',

  // --- Inventory ---
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_MANAGE: 'inventory.manage',
  INVENTORY_STOCK_ADJUST: 'inventory.stock.adjust',
  PURCHASES_MANAGE: 'purchases.manage',

  // --- Admissions ---
  ADMISSIONS_VIEW: 'admissions.view',
  ADMISSIONS_MANAGE: 'admissions.manage',
  ADMISSIONS_CONVERT: 'admissions.convert',

  // --- Documents & certificates ---
  DOCUMENTS_VIEW: 'documents.view',
  DOCUMENTS_UPLOAD: 'documents.upload',
  DOCUMENTS_DELETE: 'documents.delete',
  CERTIFICATES_GENERATE: 'certificates.generate',
  ID_CARDS_GENERATE: 'id_cards.generate',

  // --- Reports & analytics ---
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',
  ANALYTICS_VIEW: 'analytics.view',

  // --- Audit ---
  AUDIT_LOGS_VIEW: 'audit_logs.view',

  // --- Website CMS ---
  WEBSITE_VIEW: 'website.view',
  WEBSITE_MANAGE: 'website.manage',

  // --- Support ---
  SUPPORT_TICKETS_VIEW: 'support.tickets.view',
  SUPPORT_TICKETS_CREATE: 'support.tickets.create',
  SUPPORT_TICKETS_MANAGE: 'support.tickets.manage',

  // --- Self-service (held by students and parents) ---
  SELF_PROFILE_VIEW: 'self.profile.view',
  SELF_PROFILE_UPDATE: 'self.profile.update',
  SELF_CHILDREN_VIEW: 'self.children.view',
  SELF_ATTENDANCE_VIEW: 'self.attendance.view',
  SELF_FEES_VIEW: 'self.fees.view',
  SELF_FEES_PAY: 'self.fees.pay',
  SELF_RESULTS_VIEW: 'self.results.view',
  SELF_HOMEWORK_VIEW: 'self.homework.view',
  SELF_TIMETABLE_VIEW: 'self.timetable.view',
  SELF_TRANSPORT_VIEW: 'self.transport.view',
  SELF_LIBRARY_VIEW: 'self.library.view',
  SELF_DOCUMENTS_VIEW: 'self.documents.view',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSIONS);

export function parsePermission(key: string): { module: string; action: string } {
  const parts = key.split('.');
  return { module: parts[0] ?? 'unknown', action: parts.slice(1).join('.') || 'unknown' };
}

const P = PERMISSIONS;

/** Permissions common to every authenticated portal user. */
const SELF_SERVICE: PermissionKey[] = [
  P.SELF_PROFILE_VIEW,
  P.SELF_PROFILE_UPDATE,
  P.NOTICES_VIEW,
  P.EVENTS_VIEW,
  P.MESSAGES_VIEW,
  P.MESSAGES_SEND,
  P.SUPPORT_TICKETS_CREATE,
  P.SUPPORT_TICKETS_VIEW,
];

const TEACHER_PERMISSIONS: PermissionKey[] = [
  ...SELF_SERVICE,
  P.STUDENTS_VIEW,
  P.GUARDIANS_VIEW,
  P.CLASSES_VIEW,
  P.SECTIONS_VIEW,
  P.SUBJECTS_VIEW,
  P.ACADEMIC_YEARS_VIEW,
  P.ATTENDANCE_VIEW,
  P.ATTENDANCE_MARK,
  P.ATTENDANCE_EDIT,
  P.ATTENDANCE_REPORTS,
  P.STAFF_ATTENDANCE_VIEW,
  P.STAFF_ATTENDANCE_MARK,
  P.TIMETABLE_VIEW,
  P.HOMEWORK_VIEW,
  P.HOMEWORK_CREATE,
  P.HOMEWORK_UPDATE,
  P.HOMEWORK_DELETE,
  P.HOMEWORK_REVIEW,
  P.ASSIGNMENTS_VIEW,
  P.ASSIGNMENTS_CREATE,
  P.ASSIGNMENTS_UPDATE,
  P.ASSIGNMENTS_DELETE,
  P.ASSIGNMENTS_GRADE,
  P.EXAMS_VIEW,
  P.EXAMS_ENTER_MARKS,
  P.REPORT_CARDS_VIEW,
  P.LEAVE_VIEW,
  P.LEAVE_APPLY,
  P.LIBRARY_VIEW,
  P.DOCUMENTS_VIEW,
  P.REPORTS_VIEW,
  P.NOTICES_CREATE,
  P.COMMUNICATION_SEND,
];

const ACCOUNTANT_PERMISSIONS: PermissionKey[] = [
  ...SELF_SERVICE,
  P.STUDENTS_VIEW,
  P.STUDENTS_VIEW_ALL,
  P.GUARDIANS_VIEW,
  P.CLASSES_VIEW,
  P.SECTIONS_VIEW,
  P.FEES_VIEW,
  P.FEES_STRUCTURE_MANAGE,
  P.FEES_INVOICE_CREATE,
  P.FEES_INVOICE_CANCEL,
  P.FEES_COLLECT,
  P.FEES_DISCOUNT_MANAGE,
  P.FEES_REPORTS,
  P.FEES_EXPORT,
  P.FINANCE_DASHBOARD_VIEW,
  P.REPORTS_VIEW,
  P.REPORTS_EXPORT,
  P.COMMUNICATION_SEND,
];

const LIBRARIAN_PERMISSIONS: PermissionKey[] = [
  ...SELF_SERVICE,
  P.STUDENTS_VIEW,
  P.STAFF_VIEW,
  P.LIBRARY_VIEW,
  P.LIBRARY_MANAGE,
  P.LIBRARY_ISSUE,
  P.LIBRARY_RETURN,
  P.LIBRARY_FINE_MANAGE,
  P.REPORTS_VIEW,
  P.REPORTS_EXPORT,
];

const TRANSPORT_PERMISSIONS: PermissionKey[] = [
  ...SELF_SERVICE,
  P.STUDENTS_VIEW,
  P.TRANSPORT_VIEW,
  P.TRANSPORT_MANAGE,
  P.TRANSPORT_ASSIGN,
  P.TRANSPORT_TRACK,
  P.REPORTS_VIEW,
  P.REPORTS_EXPORT,
];

const RECEPTIONIST_PERMISSIONS: PermissionKey[] = [
  ...SELF_SERVICE,
  P.STUDENTS_VIEW,
  P.GUARDIANS_VIEW,
  P.STAFF_VIEW,
  P.ATTENDANCE_VIEW,
  P.ADMISSIONS_VIEW,
  P.ADMISSIONS_MANAGE,
  P.CLASSES_VIEW,
  P.SECTIONS_VIEW,
  P.TIMETABLE_VIEW,
  P.COMMUNICATION_SEND,
  P.LEAVE_VIEW,
];

const HR_PERMISSIONS: PermissionKey[] = [
  ...SELF_SERVICE,
  P.STAFF_VIEW,
  P.STAFF_CREATE,
  P.STAFF_UPDATE,
  P.STAFF_DELETE,
  P.STAFF_EXPORT,
  P.STAFF_DOCUMENTS_MANAGE,
  P.DEPARTMENTS_VIEW,
  P.DEPARTMENTS_MANAGE,
  P.STAFF_ATTENDANCE_VIEW,
  P.STAFF_ATTENDANCE_MARK,
  P.STAFF_ATTENDANCE_EDIT,
  P.LEAVE_VIEW_ALL,
  P.LEAVE_APPROVE,
  P.LEAVE_TYPES_MANAGE,
  P.PAYROLL_VIEW,
  P.PAYROLL_MANAGE,
  P.REPORTS_VIEW,
  P.REPORTS_EXPORT,
  P.USERS_VIEW,
];

const PARENT_PERMISSIONS: PermissionKey[] = [
  P.SELF_PROFILE_VIEW,
  P.SELF_PROFILE_UPDATE,
  P.SELF_CHILDREN_VIEW,
  P.SELF_ATTENDANCE_VIEW,
  P.SELF_FEES_VIEW,
  P.SELF_FEES_PAY,
  P.SELF_RESULTS_VIEW,
  P.SELF_HOMEWORK_VIEW,
  P.SELF_TIMETABLE_VIEW,
  P.SELF_TRANSPORT_VIEW,
  P.SELF_LIBRARY_VIEW,
  P.SELF_DOCUMENTS_VIEW,
  P.NOTICES_VIEW,
  P.EVENTS_VIEW,
  P.MESSAGES_VIEW,
  P.MESSAGES_SEND,
  P.LEAVE_APPLY,
  P.LEAVE_VIEW,
  P.SUPPORT_TICKETS_CREATE,
  P.SUPPORT_TICKETS_VIEW,
];

const STUDENT_PERMISSIONS: PermissionKey[] = [
  P.SELF_PROFILE_VIEW,
  P.SELF_ATTENDANCE_VIEW,
  P.SELF_FEES_VIEW,
  P.SELF_RESULTS_VIEW,
  P.SELF_HOMEWORK_VIEW,
  P.SELF_TIMETABLE_VIEW,
  P.SELF_TRANSPORT_VIEW,
  P.SELF_LIBRARY_VIEW,
  P.SELF_DOCUMENTS_VIEW,
  P.HOMEWORK_SUBMIT,
  P.ASSIGNMENTS_SUBMIT,
  P.NOTICES_VIEW,
  P.EVENTS_VIEW,
  P.MESSAGES_VIEW,
  P.MESSAGES_SEND,
  P.LEAVE_APPLY,
  P.LEAVE_VIEW,
  P.SUPPORT_TICKETS_CREATE,
  P.SUPPORT_TICKETS_VIEW,
];

/** Everything a school-scoped administrator may do (i.e. no platform keys). */
const SCHOOL_ADMIN_PERMISSIONS: PermissionKey[] = ALL_PERMISSIONS.filter(
  (key) => !key.startsWith('platform.'),
);

const PRINCIPAL_PERMISSIONS: PermissionKey[] = SCHOOL_ADMIN_PERMISSIONS.filter(
  (key) => key !== P.SCHOOL_MODULES_MANAGE && key !== P.ROLES_DELETE && key !== P.USERS_DELETE,
);

const VICE_PRINCIPAL_PERMISSIONS: PermissionKey[] = PRINCIPAL_PERMISSIONS.filter(
  (key) =>
    ![
      P.FEES_REFUND,
      P.FEES_DISCOUNT_APPROVE,
      P.PAYROLL_MANAGE,
      P.PERMISSIONS_ASSIGN,
      P.ROLES_CREATE,
      P.ROLES_UPDATE,
      P.SCHOOL_UPDATE,
    ].includes(key as never),
);

/**
 * Default permission grant per system role, applied when a school is created.
 * A school admin may subsequently add or remove grants for non-system roles.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<RoleType, PermissionKey[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  SCHOOL_ADMIN: SCHOOL_ADMIN_PERMISSIONS,
  PRINCIPAL: PRINCIPAL_PERMISSIONS,
  VICE_PRINCIPAL: VICE_PRINCIPAL_PERMISSIONS,
  TEACHER: TEACHER_PERMISSIONS,
  ACCOUNTANT: ACCOUNTANT_PERMISSIONS,
  LIBRARIAN: LIBRARIAN_PERMISSIONS,
  TRANSPORT_MANAGER: TRANSPORT_PERMISSIONS,
  RECEPTIONIST: RECEPTIONIST_PERMISSIONS,
  HR_MANAGER: HR_PERMISSIONS,
  STUDENT: STUDENT_PERMISSIONS,
  PARENT: PARENT_PERMISSIONS,
  STAFF: SELF_SERVICE,
};

export const ROLE_LABELS: Record<RoleType, string> = {
  SUPER_ADMIN: 'Super Administrator',
  SCHOOL_ADMIN: 'School Administrator',
  PRINCIPAL: 'Principal',
  VICE_PRINCIPAL: 'Vice Principal',
  TEACHER: 'Teacher',
  ACCOUNTANT: 'Accountant',
  LIBRARIAN: 'Librarian',
  TRANSPORT_MANAGER: 'Transport Manager',
  RECEPTIONIST: 'Receptionist',
  HR_MANAGER: 'HR Manager',
  STUDENT: 'Student',
  PARENT: 'Parent',
  STAFF: 'Staff',
};

/** Roles that must always exist for a school and cannot be deleted. */
export const SYSTEM_ROLES: RoleType[] = [
  RoleType.SCHOOL_ADMIN,
  RoleType.PRINCIPAL,
  RoleType.TEACHER,
  RoleType.STUDENT,
  RoleType.PARENT,
];
