import type {
  AttendanceStatus,
  BloodGroup,
  Gender,
  InvoiceStatus,
  LeaveStatus,
  LibraryIssueStatus,
  PaymentMethod,
  PaymentStatus,
  Priority,
  RoleType,
  StudentStatus,
  Weekday,
} from './enums';

/** The principal returned by `/auth/me` and after a login. */
export interface CurrentUser {
  id: string;
  schoolId: string | null;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string | null;
  displayName: string;
  avatarUrl: string | null;
  status: string;
  locale: string;
  timezone: string | null;
  roles: RoleType[];
  permissions: string[];
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  staffId: string | null;
  studentId: string | null;
  guardianId: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface LoginResult {
  user: CurrentUser;
  tokens: AuthTokens;
}

export interface SchoolSummary {
  id: string;
  code: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  currency: string;
  timezone: string;
  status: string;
  enabledModules: Record<string, boolean>;
}

export interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

export interface ClassRecord {
  id: string;
  name: string;
  level: number;
  academicYearId: string;
  sections?: SectionRecord[];
}

export interface SectionRecord {
  id: string;
  name: string;
  classId: string;
  capacity: number;
  classTeacherId: string | null;
}

export interface Subject {
  id: string;
  name: string;
  code: string;
  isElective?: boolean;
}

export interface GuardianSummary {
  id: string;
  firstName: string;
  lastName: string | null;
  relation: string;
  phone: string | null;
  email: string | null;
  isPrimary?: boolean;
}

export interface Student {
  id: string;
  admissionNumber: string;
  rollNumber: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  dateOfBirth: string;
  gender: Gender;
  bloodGroup: BloodGroup;
  photoUrl: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  admissionDate: string;
  status: StudentStatus;
  enrollments?: Array<{
    id: string;
    rollNumber: string | null;
    class: { id: string; name: string } | null;
    section: { id: string; name: string } | null;
  }>;
  guardians?: Array<{ isPrimary: boolean; guardian: GuardianSummary }>;
}

export interface StaffMember {
  id: string;
  employeeId: string;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string;
  photoUrl: string | null;
  employmentStatus: string;
  joiningDate: string;
  designation: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  date: string;
  status: AttendanceStatus;
  remarks: string | null;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  subtotal: string | number;
  discountTotal: string | number;
  taxTotal: string | number;
  lateFee: string | number;
  total: string | number;
  paidAmount: string | number;
  balance: string | number;
  currency: string;
  student?: Pick<Student, 'id' | 'admissionNumber' | 'firstName' | 'lastName'>;
}

export interface Payment {
  id: string;
  receiptNumber: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: string | number;
  currency: string;
  paidAt: string | null;
  referenceNumber: string | null;
  student?: Pick<Student, 'id' | 'admissionNumber' | 'firstName' | 'lastName'>;
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  audience: string;
  priority: Priority;
  status: string;
  isPinned: boolean;
  publishAt: string | null;
  expiresAt: string | null;
}

export interface LeaveRequest {
  id: string;
  applicantType: string;
  fromDate: string;
  toDate: string;
  totalDays: string | number;
  reason: string;
  status: LeaveStatus;
  leaveType: { id: string; name: string } | null;
}

export interface TimetableSlot {
  id: string;
  dayOfWeek: Weekday;
  period: { id: string; name: string; startTime: string; endTime: string } | null;
  class: { id: string; name: string } | null;
  section: { id: string; name: string } | null;
  subject: { id: string; name: string } | null;
  staff: { id: string; firstName: string; lastName: string | null } | null;
  room: { id: string; name: string } | null;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  publisher: string | null;
  rackLocation: string | null;
  totalCopies: number;
  availableCopies: number;
  category: { id: string; name: string } | null;
}

export interface LibraryIssue {
  id: string;
  issueDate: string;
  dueDate: string;
  returnDate: string | null;
  status: LibraryIssueStatus;
  daysOverdue: number;
  outstandingFine: number;
  bookCopy: { accessionNumber: string; book: { id: string; title: string; author: string } };
  student: Pick<Student, 'id' | 'admissionNumber' | 'firstName' | 'lastName'> | null;
}

export interface InventoryItem {
  id: string;
  name: string;
  code: string;
  unit: string;
  quantity: string | number;
  reorderLevel: string | number;
  unitCost: string | number;
  location: string | null;
  isActive: boolean;
  stockValue: number;
  isLowStock: boolean;
  category: { id: string; name: string } | null;
}

export interface Vehicle {
  id: string;
  registrationNumber: string;
  name: string | null;
  capacity: number;
  status: string;
  trackingEnabled: boolean;
}

export interface TransportRoute {
  id: string;
  name: string;
  code: string;
  baseFare: string | number;
  isActive: boolean;
  studentCount: number;
  seatsRemaining: number | null;
  vehicle: Vehicle | null;
  driver: { id: string; name: string; phone: string } | null;
  stops: Array<{
    id: string;
    name: string;
    sequence: number;
    pickupTime: string | null;
    dropTime: string | null;
  }>;
}

// --- Dashboard -------------------------------------------------------------

export interface DashboardMetric {
  label: string;
  value: number;
  changePercent?: number;
  format?: 'number' | 'currency' | 'percent';
}

export interface ChartPoint {
  label: string;
  value: number;
}

export interface AdminDashboard {
  audience: 'ADMIN';
  academicYear: string;
  metrics: DashboardMetric[];
  attendanceToday: {
    marked: number;
    present: number;
    absent: number;
    late: number;
    notMarked: boolean;
  };
  finance: { receiptsToday: number; outstandingInvoices: number };
  actionQueue: { pendingLeave: number; openTickets: number; noticesThisWeek: number };
  upcomingExams: Array<{
    id: string;
    name: string;
    type: string;
    startDate: string;
    endDate: string;
  }>;
  charts: {
    enrolmentTrend: ChartPoint[];
    collectionTrend: ChartPoint[];
    attendanceTrend: ChartPoint[];
    classStrength: ChartPoint[];
  };
}

export interface TeacherDashboard {
  audience: 'TEACHER';
  academicYear: string;
  metrics: DashboardMetric[];
  todaySchedule: Array<{
    id: string;
    period: string;
    startTime: string;
    endTime: string;
    className: string;
    sectionId: string | null;
    sectionName: string;
    subject: string;
    room: string | null;
    attendanceMarked: boolean;
  }>;
  classes: Array<{
    sectionId: string;
    className: string;
    sectionName: string;
    students: number;
  }>;
  actionQueue: {
    attendanceOutstanding: number;
    submissionsToReview: number;
    marksPending: number;
    unreadMessages: number;
  };
  homeworkDue: number;
}

export interface ChildSummary {
  studentId: string;
  name: string;
  admissionNumber: string;
  photoUrl: string | null;
  className: string;
  sectionName: string;
  attendance: {
    today: AttendanceStatus | null;
    monthPercent: number | null;
    monthMarkedDays: number;
  };
  fees: { outstanding: number; unpaidInvoices: number };
  homework: Array<{
    id: string;
    title: string;
    subject: string;
    dueDate: string;
    submitted: boolean;
    status: string;
  }>;
  nextExam: { name: string; subject: string; date: string; startTime: string } | null;
  transport: {
    route: string;
    bus: string | null;
    stop: string | null;
    pickupTime: string | null;
  } | null;
}

export interface ParentDashboard {
  audience: 'PARENT';
  academicYear: string;
  children: ChildSummary[];
  notices: Array<{
    id: string;
    title: string;
    priority: Priority;
    isPinned: boolean;
    publishAt: string | null;
  }>;
}

export interface PlatformDashboard {
  audience: 'PLATFORM';
  metrics: DashboardMetric[];
  subscriptions: Array<{ plan: string; tier: string; status: string; count: number }>;
  recentSchools: Array<{
    id: string;
    name: string;
    code: string;
    status: string;
    createdAt: string;
  }>;
}

export type Dashboard =
  | AdminDashboard
  | TeacherDashboard
  | ParentDashboard
  | PlatformDashboard
  | ({ audience: 'STUDENT'; academicYear: string; child: ChildSummary } & {
      notices: ParentDashboard['notices'];
    });

// --- Search and reports ----------------------------------------------------

export interface SearchHit {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  url: string;
  badge?: string;
}

export interface SearchGroup {
  type: string;
  label: string;
  hits: SearchHit[];
  more: boolean;
}

export interface SearchResults {
  term: string;
  groups: SearchGroup[];
  total: number;
}

export interface ReportFilterSpec {
  key: string;
  label: string;
  type: 'date' | 'uuid' | 'text' | 'enum' | 'boolean';
  required?: boolean;
  options?: string[];
  source?: string;
}

export interface ReportSummaryItem {
  key: string;
  name: string;
  description: string;
  module: string;
  filters: ReportFilterSpec[];
  columns: Array<{ key: string; label: string; type: string }>;
}

export interface ReportRun {
  key: string;
  name: string;
  academicYear: string;
  columns: Array<{ key: string; label: string; type?: string }>;
  summary: Array<{ label: string; value: string }>;
  totals: Record<string, string | number> | null;
  items: Array<Record<string, string | number | null>>;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  actionUrl: string | null;
  isRead: boolean;
  createdAt: string;
}
