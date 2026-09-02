import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { PERMISSIONS } from '../../common/constants/permissions';
import { isModuleEnabled } from '../../common/constants/modules';
import { MODULES } from '../../common/constants/modules';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

export interface SearchHit {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  /** Where the web app should navigate when the hit is chosen. */
  url: string;
  badge?: string;
}

export interface SearchGroup {
  type: string;
  label: string;
  hits: SearchHit[];
  /** Set when more matches exist than were returned. */
  more: boolean;
}

interface Source {
  type: string;
  label: string;
  permission: string;
  module: string;
  search(
    prisma: PrismaService,
    schoolId: string,
    term: string,
    take: number,
  ): Promise<SearchHit[]>;
}

const PER_GROUP = 5;

function name(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Every searchable entity, each declaring what it needs before it is queried.
 *
 * A source the caller cannot read is skipped entirely rather than queried and
 * filtered — a global search must not become a way to probe for records the
 * user has no permission to see.
 */
const SOURCES: Source[] = [
  {
    type: 'student',
    label: 'Students',
    permission: PERMISSIONS.STUDENTS_VIEW,
    module: MODULES.STUDENTS,
    async search(prisma, schoolId, term, take) {
      const students = await prisma.student.findMany({
        where: {
          schoolId,
          deletedAt: null,
          OR: [
            { admissionNumber: { contains: term, mode: 'insensitive' } },
            { firstName: { contains: term, mode: 'insensitive' } },
            { lastName: { contains: term, mode: 'insensitive' } },
            { phone: { contains: term } },
            { email: { contains: term, mode: 'insensitive' } },
          ],
        },
        take,
        orderBy: { admissionNumber: 'asc' },
        select: {
          id: true,
          admissionNumber: true,
          firstName: true,
          middleName: true,
          lastName: true,
          status: true,
          enrollments: {
            where: { status: 'ACTIVE' },
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              class: { select: { name: true } },
              section: { select: { name: true } },
            },
          },
        },
      });

      return students.map((student) => {
        const enrollment = student.enrollments[0];
        return {
          type: 'student',
          id: student.id,
          title: name([student.firstName, student.middleName, student.lastName]),
          subtitle: [
            student.admissionNumber,
            enrollment ? `${enrollment.class?.name ?? ''} ${enrollment.section?.name ?? ''}`.trim() : null,
          ]
            .filter(Boolean)
            .join(' • '),
          url: `/students/${student.id}`,
          badge: student.status === 'ACTIVE' ? undefined : student.status,
        };
      });
    },
  },

  {
    type: 'guardian',
    label: 'Parents',
    permission: PERMISSIONS.GUARDIANS_VIEW,
    module: MODULES.STUDENTS,
    async search(prisma, schoolId, term, take) {
      const guardians = await prisma.guardian.findMany({
        where: {
          schoolId,
          OR: [
            { firstName: { contains: term, mode: 'insensitive' } },
            { lastName: { contains: term, mode: 'insensitive' } },
            { phone: { contains: term } },
            { email: { contains: term, mode: 'insensitive' } },
          ],
        },
        take,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          relation: true,
          _count: { select: { students: true } },
        },
      });

      return guardians.map((guardian) => ({
        type: 'guardian',
        id: guardian.id,
        title: name([guardian.firstName, guardian.lastName]),
        subtitle: [
          guardian.phone,
          `${guardian._count.students} child${guardian._count.students === 1 ? '' : 'ren'}`,
        ]
          .filter(Boolean)
          .join(' • '),
        url: `/guardians/${guardian.id}`,
        badge: guardian.relation,
      }));
    },
  },

  {
    type: 'staff',
    label: 'Staff',
    permission: PERMISSIONS.STAFF_VIEW,
    module: MODULES.STAFF,
    async search(prisma, schoolId, term, take) {
      const staff = await prisma.staff.findMany({
        where: {
          schoolId,
          OR: [
            { employeeId: { contains: term, mode: 'insensitive' } },
            { firstName: { contains: term, mode: 'insensitive' } },
            { lastName: { contains: term, mode: 'insensitive' } },
            { phone: { contains: term } },
            { email: { contains: term, mode: 'insensitive' } },
          ],
        },
        take,
        select: {
          id: true,
          employeeId: true,
          firstName: true,
          middleName: true,
          lastName: true,
          employmentStatus: true,
          designation: { select: { name: true } },
          department: { select: { name: true } },
        },
      });

      return staff.map((member) => ({
        type: 'staff',
        id: member.id,
        title: name([member.firstName, member.middleName, member.lastName]),
        subtitle: [member.employeeId, member.designation?.name, member.department?.name]
          .filter(Boolean)
          .join(' • '),
        url: `/staff/${member.id}`,
        badge: member.employmentStatus === 'ACTIVE' ? undefined : member.employmentStatus,
      }));
    },
  },

  {
    type: 'invoice',
    label: 'Invoices',
    permission: PERMISSIONS.FEES_VIEW,
    module: MODULES.FEES,
    async search(prisma, schoolId, term, take) {
      const invoices = await prisma.invoice.findMany({
        where: { schoolId, invoiceNumber: { contains: term, mode: 'insensitive' } },
        take,
        orderBy: { issueDate: 'desc' },
        select: {
          id: true,
          invoiceNumber: true,
          total: true,
          balance: true,
          status: true,
          student: { select: { firstName: true, lastName: true, admissionNumber: true } },
        },
      });

      return invoices.map((invoice) => ({
        type: 'invoice',
        id: invoice.id,
        title: invoice.invoiceNumber,
        subtitle: [
          name([invoice.student.firstName, invoice.student.lastName]),
          invoice.student.admissionNumber,
          `Balance ${Number(invoice.balance).toLocaleString('en-IN')}`,
        ].join(' • '),
        url: `/fees/invoices/${invoice.id}`,
        badge: invoice.status,
      }));
    },
  },

  {
    type: 'payment',
    label: 'Receipts',
    permission: PERMISSIONS.FEES_VIEW,
    module: MODULES.FEES,
    async search(prisma, schoolId, term, take) {
      const payments = await prisma.payment.findMany({
        where: {
          schoolId,
          OR: [
            { receiptNumber: { contains: term, mode: 'insensitive' } },
            { referenceNumber: { contains: term, mode: 'insensitive' } },
            { gatewayPaymentId: { contains: term, mode: 'insensitive' } },
          ],
        },
        take,
        orderBy: { paidAt: 'desc' },
        select: {
          id: true,
          receiptNumber: true,
          amount: true,
          method: true,
          status: true,
          student: { select: { firstName: true, lastName: true, admissionNumber: true } },
        },
      });

      return payments.map((payment) => ({
        type: 'payment',
        id: payment.id,
        title: payment.receiptNumber,
        subtitle: [
          name([payment.student.firstName, payment.student.lastName]),
          `${Number(payment.amount).toLocaleString('en-IN')} by ${payment.method.replace(/_/g, ' ')}`,
        ].join(' • '),
        url: `/fees/payments/${payment.id}`,
        badge: payment.status,
      }));
    },
  },

  {
    type: 'notice',
    label: 'Notices',
    permission: PERMISSIONS.NOTICES_VIEW,
    module: MODULES.COMMUNICATION,
    async search(prisma, schoolId, term, take) {
      const notices = await prisma.notice.findMany({
        where: {
          schoolId,
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { body: { contains: term, mode: 'insensitive' } },
          ],
        },
        take,
        orderBy: { publishAt: 'desc' },
        select: {
          id: true,
          title: true,
          audience: true,
          status: true,
          publishAt: true,
        },
      });

      return notices.map((notice) => ({
        type: 'notice',
        id: notice.id,
        title: notice.title,
        subtitle: [
          notice.audience,
          notice.publishAt ? notice.publishAt.toISOString().slice(0, 10) : 'Unscheduled',
        ].join(' • '),
        url: `/notices/${notice.id}`,
        badge: notice.status,
      }));
    },
  },

  {
    type: 'book',
    label: 'Library',
    permission: PERMISSIONS.LIBRARY_VIEW,
    module: MODULES.LIBRARY,
    async search(prisma, schoolId, term, take) {
      const books = await prisma.book.findMany({
        where: {
          schoolId,
          deletedAt: null,
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { author: { contains: term, mode: 'insensitive' } },
            { isbn: { contains: term } },
          ],
        },
        take,
        select: {
          id: true,
          title: true,
          author: true,
          availableCopies: true,
          totalCopies: true,
          rackLocation: true,
        },
      });

      return books.map((book) => ({
        type: 'book',
        id: book.id,
        title: book.title,
        subtitle: [book.author, book.rackLocation].filter(Boolean).join(' • '),
        url: `/library/books/${book.id}`,
        badge: `${book.availableCopies}/${book.totalCopies} available`,
      }));
    },
  },

  {
    type: 'inventory',
    label: 'Inventory',
    permission: PERMISSIONS.INVENTORY_VIEW,
    module: MODULES.INVENTORY,
    async search(prisma, schoolId, term, take) {
      const items = await prisma.inventoryItem.findMany({
        where: {
          schoolId,
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { code: { contains: term, mode: 'insensitive' } },
          ],
        },
        take,
        select: {
          id: true,
          name: true,
          code: true,
          quantity: true,
          unit: true,
          location: true,
        },
      });

      return items.map((item) => ({
        type: 'inventory',
        id: item.id,
        title: item.name,
        subtitle: [item.code, item.location].filter(Boolean).join(' • '),
        url: `/inventory/items/${item.id}`,
        badge: `${Number(item.quantity)} ${item.unit}`,
      }));
    },
  },

  {
    type: 'homework',
    label: 'Homework',
    permission: PERMISSIONS.HOMEWORK_VIEW,
    module: MODULES.HOMEWORK,
    async search(prisma, schoolId, term, take) {
      const homework = await prisma.homework.findMany({
        where: {
          schoolId,
          deletedAt: null,
          title: { contains: term, mode: 'insensitive' },
        },
        take,
        orderBy: { dueDate: 'desc' },
        select: {
          id: true,
          title: true,
          dueDate: true,
          subject: { select: { name: true } },
          class: { select: { name: true } },
          section: { select: { name: true } },
        },
      });

      return homework.map((item) => ({
        type: 'homework',
        id: item.id,
        title: item.title,
        subtitle: [
          item.subject?.name,
          `${item.class?.name ?? ''} ${item.section?.name ?? ''}`.trim(),
          `Due ${item.dueDate.toISOString().slice(0, 10)}`,
        ]
          .filter(Boolean)
          .join(' • '),
        url: `/homework/${item.id}`,
      }));
    },
  },

  {
    type: 'exam',
    label: 'Exams',
    permission: PERMISSIONS.EXAMS_VIEW,
    module: MODULES.EXAMS,
    async search(prisma, schoolId, term, take) {
      const exams = await prisma.exam.findMany({
        where: { schoolId, deletedAt: null, name: { contains: term, mode: 'insensitive' } },
        take,
        orderBy: { startDate: 'desc' },
        select: { id: true, name: true, type: true, status: true, startDate: true },
      });

      return exams.map((exam) => ({
        type: 'exam',
        id: exam.id,
        title: exam.name,
        subtitle: [exam.type, exam.startDate.toISOString().slice(0, 10)].join(' • '),
        url: `/exams/${exam.id}`,
        badge: exam.status,
      }));
    },
  },

  {
    type: 'event',
    label: 'Events',
    permission: PERMISSIONS.EVENTS_VIEW,
    module: MODULES.EVENTS,
    async search(prisma, schoolId, term, take) {
      const events = await prisma.event.findMany({
        where: {
          schoolId,
          deletedAt: null,
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { venue: { contains: term, mode: 'insensitive' } },
          ],
        },
        take,
        orderBy: { startAt: 'desc' },
        select: { id: true, title: true, type: true, venue: true, startAt: true, isPublished: true },
      });

      return events.map((event) => ({
        type: 'event',
        id: event.id,
        title: event.title,
        subtitle: [event.venue, event.startAt.toISOString().slice(0, 10)].filter(Boolean).join(' • '),
        url: `/events?q=${encodeURIComponent(event.title)}`,
        badge: event.isPublished ? undefined : 'Draft',
      }));
    },
  },

  {
    type: 'admission',
    label: 'Admissions',
    permission: PERMISSIONS.ADMISSIONS_VIEW,
    module: MODULES.ADMISSIONS,
    async search(prisma, schoolId, term, take) {
      const enquiries = await prisma.admissionEnquiry.findMany({
        where: {
          schoolId,
          OR: [
            { enquiryNumber: { contains: term, mode: 'insensitive' } },
            { studentFirstName: { contains: term, mode: 'insensitive' } },
            { studentLastName: { contains: term, mode: 'insensitive' } },
            { parentName: { contains: term, mode: 'insensitive' } },
            { phone: { contains: term } },
          ],
        },
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          enquiryNumber: true,
          studentFirstName: true,
          studentLastName: true,
          seekingClass: true,
          status: true,
        },
      });

      return enquiries.map((enquiry) => ({
        type: 'admission',
        id: enquiry.id,
        title: name([enquiry.studentFirstName, enquiry.studentLastName]),
        subtitle: [enquiry.enquiryNumber, `Seeking ${enquiry.seekingClass}`].join(' • '),
        url: `/admissions?q=${encodeURIComponent(enquiry.enquiryNumber)}`,
        badge: enquiry.status,
      }));
    },
  },

  {
    type: 'route',
    label: 'Transport routes',
    permission: PERMISSIONS.TRANSPORT_VIEW,
    module: MODULES.TRANSPORT,
    async search(prisma, schoolId, term, take) {
      const routes = await prisma.transportRoute.findMany({
        where: {
          schoolId,
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { code: { contains: term, mode: 'insensitive' } },
          ],
        },
        take,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          code: true,
          isActive: true,
          vehicle: { select: { registrationNumber: true } },
          _count: { select: { stops: true, assignments: true } },
        },
      });

      return routes.map((route) => ({
        type: 'route',
        id: route.id,
        title: route.name,
        subtitle: [
          route.code,
          route.vehicle?.registrationNumber,
          `${route._count.stops} stops`,
          `${route._count.assignments} students`,
        ]
          .filter(Boolean)
          .join(' • '),
        url: `/transport`,
        badge: route.isActive ? undefined : 'Inactive',
      }));
    },
  },

  {
    type: 'certificate',
    label: 'Certificates',
    permission: PERMISSIONS.CERTIFICATES_GENERATE,
    module: MODULES.CERTIFICATES,
    async search(prisma, schoolId, term, take) {
      const certificates = await prisma.certificate.findMany({
        where: {
          schoolId,
          OR: [
            { certificateNumber: { contains: term, mode: 'insensitive' } },
            { student: { firstName: { contains: term, mode: 'insensitive' } } },
            { student: { lastName: { contains: term, mode: 'insensitive' } } },
            { student: { admissionNumber: { contains: term, mode: 'insensitive' } } },
          ],
        },
        take,
        orderBy: { issuedOn: 'desc' },
        select: {
          id: true,
          certificateNumber: true,
          type: true,
          isRevoked: true,
          student: { select: { firstName: true, lastName: true } },
        },
      });

      return certificates.map((certificate) => ({
        type: 'certificate',
        id: certificate.id,
        title: certificate.certificateNumber,
        subtitle: [
          certificate.type.replace(/_/g, ' '),
          certificate.student
            ? name([certificate.student.firstName, certificate.student.lastName])
            : null,
        ]
          .filter(Boolean)
          .join(' • '),
        url: `/certificates?q=${encodeURIComponent(certificate.certificateNumber)}`,
        badge: certificate.isRevoked ? 'Revoked' : undefined,
      }));
    },
  },
];

@Injectable()
export class SearchService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    logger: AppLogger,
  ) {
    this.log = logger.child('SearchService');
  }

  /** The entity types this user can search, for the UI's filter chips. */
  async sources(schoolId: string, user: AuthenticatedUser) {
    const allowed = await this.allowedSources(schoolId, user);
    return allowed.map((source) => ({ type: source.type, label: source.label }));
  }

  /**
   * Searches every entity the user may read, in parallel.
   *
   * Each source is capped so one prolific type cannot crowd out the rest, and
   * one extra row is fetched per group purely to report whether more exist.
   */
  async search(
    schoolId: string,
    user: AuthenticatedUser,
    term: string,
    types?: string[],
    limit = PER_GROUP,
  ): Promise<{ term: string; groups: SearchGroup[]; total: number }> {
    const trimmed = term.trim();

    // A single character matches nearly everything and costs a table scan per
    // source; make the caller be more specific.
    if (trimmed.length < 2) {
      return { term: trimmed, groups: [], total: 0 };
    }

    const allowed = await this.allowedSources(schoolId, user);
    const selected =
      types && types.length > 0
        ? allowed.filter((source) => types.includes(source.type))
        : allowed;

    const perGroup = Math.min(25, Math.max(1, limit));
    const started = Date.now();

    const results = await Promise.all(
      selected.map(async (source) => {
        try {
          const hits = await source.search(this.prisma, schoolId, trimmed, perGroup + 1);
          return {
            type: source.type,
            label: source.label,
            hits: hits.slice(0, perGroup),
            more: hits.length > perGroup,
          };
        } catch (error) {
          // One failing source must not take the whole search down.
          this.log.warn('Search source failed', {
            schoolId,
            source: source.type,
            error: error instanceof Error ? error.message : String(error),
          });
          return { type: source.type, label: source.label, hits: [], more: false };
        }
      }),
    );

    const groups = results.filter((group) => group.hits.length > 0);
    const total = groups.reduce((sum, group) => sum + group.hits.length, 0);

    this.log.debug('Global search', {
      schoolId,
      term: trimmed,
      sources: selected.length,
      hits: total,
      durationMs: Date.now() - started,
    });

    return { term: trimmed, groups, total };
  }

  private async allowedSources(
    schoolId: string,
    user: AuthenticatedUser,
  ): Promise<Source[]> {
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { enabledModules: true },
    });

    return SOURCES.filter(
      (source) =>
        (user.isSuperAdmin || user.permissions.includes(source.permission)) &&
        isModuleEnabled(school.enabledModules, source.module),
    );
  }
}
