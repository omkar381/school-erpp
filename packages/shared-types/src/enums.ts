/**
 * Enumerations mirrored from the Prisma schema.
 *
 * Declared as const objects rather than TypeScript enums so they can be
 * iterated to build a dropdown, and so the values are plain strings at runtime.
 */

export const ROLE_TYPES = [
  'SUPER_ADMIN',
  'SCHOOL_ADMIN',
  'PRINCIPAL',
  'VICE_PRINCIPAL',
  'TEACHER',
  'ACCOUNTANT',
  'LIBRARIAN',
  'TRANSPORT_MANAGER',
  'RECEPTIONIST',
  'HR_MANAGER',
  'STUDENT',
  'PARENT',
  'STAFF',
] as const;
export type RoleType = (typeof ROLE_TYPES)[number];

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

export const STUDENT_STATUSES = [
  'ACTIVE',
  'INACTIVE',
  'TRANSFERRED',
  'ALUMNI',
  'SUSPENDED',
] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const ATTENDANCE_STATUSES = [
  'PRESENT',
  'ABSENT',
  'LATE',
  'HALF_DAY',
  'EXCUSED',
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  HALF_DAY: 'Half day',
  EXCUSED: 'Excused',
};

export const INVOICE_STATUSES = [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'CANCELLED',
  'VOID',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'PENDING',
  'PROCESSING',
  'SUCCESS',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'CANCELLED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = [
  'CASH',
  'UPI',
  'CARD',
  'NET_BANKING',
  'CHEQUE',
  'DEMAND_DRAFT',
  'BANK_TRANSFER',
  'ONLINE_GATEWAY',
  'WALLET',
  'ADJUSTMENT',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const REFUND_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'PROCESSING',
  'COMPLETED',
  'REJECTED',
  'FAILED',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
export type Gender = (typeof GENDERS)[number];

export const GUARDIAN_RELATIONS = [
  'FATHER',
  'MOTHER',
  'GUARDIAN',
  'GRANDFATHER',
  'GRANDMOTHER',
  'UNCLE',
  'AUNT',
  'SIBLING',
  'OTHER',
] as const;
export type GuardianRelation = (typeof GUARDIAN_RELATIONS)[number];

export const BLOOD_GROUPS = [
  'A_POSITIVE',
  'A_NEGATIVE',
  'B_POSITIVE',
  'B_NEGATIVE',
  'AB_POSITIVE',
  'AB_NEGATIVE',
  'O_POSITIVE',
  'O_NEGATIVE',
  'UNKNOWN',
] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export const BLOOD_GROUP_LABELS: Record<BloodGroup, string> = {
  A_POSITIVE: 'A+',
  A_NEGATIVE: 'A−',
  B_POSITIVE: 'B+',
  B_NEGATIVE: 'B−',
  AB_POSITIVE: 'AB+',
  AB_NEGATIVE: 'AB−',
  O_POSITIVE: 'O+',
  O_NEGATIVE: 'O−',
  UNKNOWN: 'Unknown',
};

export const PRIORITIES = ['LOW', 'NORMAL', 'IMPORTANT', 'URGENT'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const LEAVE_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'CHANGES_REQUESTED',
] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const LIBRARY_ISSUE_STATUSES = [
  'ISSUED',
  'RETURNED',
  'OVERDUE',
  'LOST',
  'RENEWED',
] as const;
export type LibraryIssueStatus = (typeof LIBRARY_ISSUE_STATUSES)[number];

export const STOCK_TRANSACTION_TYPES = [
  'STOCK_IN',
  'STOCK_OUT',
  'ADJUSTMENT',
  'RETURN',
  'DAMAGE',
  'TRANSFER',
] as const;
export type StockTransactionType = (typeof STOCK_TRANSACTION_TYPES)[number];

export const WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * How a status should read on screen.
 *
 * Keeping the mapping here rather than in each table means a PAID invoice is
 * the same green everywhere it appears.
 */
export type ToneName = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export const STATUS_TONES: Record<string, ToneName> = {
  // Lifecycle
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  SUSPENDED: 'danger',
  TRANSFERRED: 'info',
  ALUMNI: 'neutral',
  ARCHIVED: 'neutral',

  // Attendance
  PRESENT: 'success',
  ABSENT: 'danger',
  LATE: 'warning',
  HALF_DAY: 'warning',
  EXCUSED: 'info',

  // Money
  PAID: 'success',
  SUCCESS: 'success',
  PARTIALLY_PAID: 'warning',
  PENDING: 'warning',
  ISSUED: 'info',
  OVERDUE: 'danger',
  FAILED: 'danger',
  REFUNDED: 'accent',
  PARTIALLY_REFUNDED: 'accent',
  CANCELLED: 'neutral',
  VOID: 'neutral',
  DRAFT: 'neutral',

  // Workflow
  APPROVED: 'success',
  REJECTED: 'danger',
  CHANGES_REQUESTED: 'warning',
  PUBLISHED: 'success',
  SCHEDULED: 'info',
  OPEN: 'info',
  IN_PROGRESS: 'warning',
  RESOLVED: 'success',
  CLOSED: 'neutral',
  REQUESTED: 'warning',
  PROCESSING: 'info',
  COMPLETED: 'success',

  // Library and stock
  RETURNED: 'success',
  LOST: 'danger',
  DAMAGED: 'danger',
  AVAILABLE: 'success',
  REORDER: 'warning',
  'OUT OF STOCK': 'danger',
};

export function toneFor(status: string | null | undefined): ToneName {
  if (!status) return 'neutral';
  return STATUS_TONES[status.toUpperCase()] ?? 'neutral';
}

/** Turns SCREAMING_SNAKE into "Screaming snake". */
export function humanise(value: string | null | undefined): string {
  if (!value) return '';
  const spaced = value.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
