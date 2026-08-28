import type { UsageValue } from '@/components/ui/meter';

export type { UsageValue };

export interface PlanSummary {
  id: string;
  code: string;
  name: string;
  tier: 'BASIC' | 'PROFESSIONAL' | 'ENTERPRISE';
  description: string | null;
  priceMonthly: string | number;
  priceYearly: string | number;
  currency: string;
  maxStudents: number;
  maxStaff: number;
  storageMb: number;
  modules: string[];
  trialDays: number;
  isActive: boolean;
  sortOrder: number;
  activeSubscriptions?: number;
}

export interface SubscriptionSummary {
  id: string;
  status: string;
  startDate: string;
  endDate: string;
  cancelledAt: string | null;
  autoRenew: boolean;
  billingCycle: string;
  amount: string | number;
  currency: string;
  daysRemaining: number;
  limitOverrides?: Record<string, number>;
  notes?: string | null;
  plan: { id: string; code: string; name: string; tier: string };
  school?: { id: string; name: string; code: string; status: string; city?: string | null };
}

export interface SchoolRow {
  id: string;
  code: string;
  slug: string;
  name: string;
  status: string;
  email: string;
  phone: string;
  city: string | null;
  state: string | null;
  board: string | null;
  logoUrl: string | null;
  createdAt: string;
  onboardedAt: string | null;
  userCount: number;
  studentCount: number;
  staffCount: number;
  studentUsagePercent: number | null;
  subscription: {
    id: string;
    status: string;
    startDate: string;
    endDate: string;
    autoRenew: boolean;
    amount: string | number;
    currency: string;
    daysRemaining: number;
    plan: { id: string; name: string; code: string; tier: string; maxStudents: number; maxStaff: number };
  } | null;
}

export interface SchoolUsage {
  schoolId: string;
  students: UsageValue;
  staff: UsageValue;
  storage: UsageValue;
  users: number;
  documents: number;
  limits: { maxStudents: number; maxStaff: number; storageMb: number };
  overridden: string[];
  plan: { id: string; code: string; name: string; tier: string } | null;
  measuredAt: string;
}

export interface ActivityEntry {
  id: string;
  action: string;
  module: string;
  entity: string;
  entityId: string | null;
  description: string | null;
  createdAt: string;
  user: { id: string; firstName: string; lastName: string | null; avatarUrl?: string | null } | null;
  school?: { id: string; name: string; code?: string } | null;
}

export interface PlatformOverview {
  schools: {
    total: number;
    active: number;
    trial: number;
    suspended: number;
    expired: number;
    archived: number;
    newThisMonth: number;
  };
  people: { students: number; staff: number; users: number };
  revenue: {
    annualRunRate: number;
    currency: string;
    payingSubscriptions: number;
    trialSubscriptions: number;
    averageContractValue: number;
  };
  support: {
    open: number;
    inProgress: number;
    waiting: number;
    resolved: number;
    closed: number;
    urgent: number;
  };
  planBreakdown: Array<{ planId: string; name: string; tier: string | null; schools: number }>;
  recentSchools: Array<{
    id: string;
    name: string;
    code: string;
    city: string | null;
    state: string | null;
    status: string;
    logoUrl: string | null;
    createdAt: string;
    studentCount: number;
    plan: string | null;
    subscriptionStatus: string | null;
  }>;
  expiringSubscriptions: Array<{
    id: string;
    status: string;
    endDate: string;
    autoRenew: boolean;
    amount: string | number;
    currency: string;
    daysRemaining: number;
    school: { id: string; name: string; code: string; status: string };
    plan: { name: string; tier: string };
  }>;
  recentActivity: ActivityEntry[];
  generatedAt: string;
}

export interface SchoolModuleState {
  key: string;
  label: string;
  core: boolean;
  inPlan: boolean;
  enabled: boolean;
}

export interface SchoolDetail {
  school: {
    id: string;
    code: string;
    slug: string;
    name: string;
    legalName: string | null;
    status: string;
    email: string;
    phone: string;
    alternatePhone: string | null;
    website: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    country: string;
    postalCode: string | null;
    board: string | null;
    affiliationNumber: string | null;
    establishedYear: number | null;
    principalName: string | null;
    timezone: string;
    currency: string;
    locale: string;
    logoUrl: string | null;
    enabledModules: Record<string, boolean>;
    onboardingStep: number;
    onboardedAt: string | null;
    createdAt: string;
  };
  subscription:
    | (SubscriptionSummary & {
        isTrial: boolean;
        plan: SubscriptionSummary['plan'] & {
          trialDays: number;
          priceMonthly: string | number;
          priceYearly: string | number;
        };
      })
    | null;
  usage: SchoolUsage;
  academicYear: { id: string; name: string; startDate: string; endDate: string } | null;
  counts: {
    classes: number;
    teachers: number;
    nonTeaching: number;
    studentsByStatus: Record<string, number>;
    openTickets: number;
  };
  administrators: Array<{
    id: string;
    firstName: string;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    status: string;
    lastLoginAt: string | null;
  }>;
  modules: SchoolModuleState[];
  recentActivity: ActivityEntry[];
}

export const SCHOOL_STATUSES = ['ACTIVE', 'TRIAL', 'SUSPENDED', 'EXPIRED', 'ARCHIVED'] as const;

export const SUBSCRIPTION_STATUSES = [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLED',
  'EXPIRED',
] as const;

export const PLAN_TIERS = ['BASIC', 'PROFESSIONAL', 'ENTERPRISE'] as const;

/** The schema calls the top band CRITICAL; every screen calls it Urgent. */
export const TICKET_PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Urgent',
};

export const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export const TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING',
  'RESOLVED',
  'CLOSED',
] as const;

export interface TicketRow {
  id: string;
  ticketNumber: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  firstResponseAt: string | null;
  messageCount: number;
  attachmentCount: number;
  school?: { id: string; name: string; code: string } | null;
  requester: {
    id: string;
    firstName: string;
    lastName: string | null;
    email: string | null;
    avatarUrl: string | null;
  } | null;
  assignee: { id: string; firstName: string; lastName: string | null; avatarUrl: string | null } | null;
}

export interface TicketAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string | null;
}

export interface TicketMessage {
  id: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  author: { id: string; firstName: string; lastName: string | null; avatarUrl: string | null };
  attachments: TicketAttachment[];
}

export interface TicketDetail extends Omit<TicketRow, 'messageCount' | 'attachmentCount'> {
  description: string;
  schoolId: string | null;
  requesterId: string;
  assigneeId: string | null;
  canReply: boolean;
  canManage: boolean;
  attachments: TicketAttachment[];
  messages: TicketMessage[];
  history: Array<{
    id: string;
    action: string;
    description: string | null;
    createdAt: string;
    user: { id: string; firstName: string; lastName: string | null } | null;
  }>;
}

export interface TicketStats {
  open: number;
  inProgress: number;
  waiting: number;
  resolved: number;
  closed: number;
  pending: number;
  urgent: number;
  unassigned: number;
  windowDays: number;
  resolvedInWindow: number;
  averageResolutionHours: number | null;
  averageFirstResponseHours: number | null;
}

export interface TicketOptions {
  categories: Array<{ value: string; label: string }>;
  priorities: Array<{ value: string; label: string }>;
  statuses: string[];
}

export interface SchoolSubscriptionView {
  school: { id: string; name: string; status: string };
  subscription:
    | {
        id: string;
        status: string;
        startDate: string;
        endDate: string;
        cancelledAt: string | null;
        billingCycle: string;
        autoRenew: boolean;
        amount: string | number;
        currency: string;
        daysRemaining: number;
        isTrial: boolean;
        trialDays: number;
      }
    | null;
  plan:
    | {
        id: string;
        code: string;
        name: string;
        tier: string;
        description: string | null;
        priceMonthly: string | number;
        priceYearly: string | number;
        currency: string;
      }
    | null;
  usage: {
    students: UsageValue;
    staff: UsageValue;
    storage: UsageValue;
    users: number;
    documents: number;
  };
  limits: { maxStudents: number; maxStaff: number; storageMb: number };
  modules: Array<{ key: string; inPlan: boolean; enabled: boolean }>;
}

export function fullName(
  person: { firstName: string; lastName: string | null } | null | undefined,
): string {
  if (!person) return '—';
  return [person.firstName, person.lastName].filter(Boolean).join(' ');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
