import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  BookCopyStatus,
  LibraryIssueStatus,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService, type TransactionClient } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { addDays, formatDate, todayInZone } from '../../common/utils/date.util';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SequenceService } from '../../common/services/sequence.service';
import type {
  BookQueryDto,
  CreateBookDto,
  IssueBookDto,
  ReturnBookDto,
  WaiveFineDto,
} from './dto/library.dto';

interface LibrarySettings {
  maxBooksPerStudent: number;
  loanDurationDays: number;
  finePerDay: number;
  maxRenewals: number;
}

const DEFAULT_SETTINGS: LibrarySettings = {
  maxBooksPerStudent: 2,
  loanDurationDays: 14,
  finePerDay: 2,
  maxRenewals: 2,
};

@Injectable()
export class LibraryService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly sequences: SequenceService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('LibraryService');
  }

  // -------------------------------------------------------------------------
  // Catalogue
  // -------------------------------------------------------------------------

  async searchBooks(schoolId: string, query: BookQueryDto) {
    const where: Prisma.BookWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.availableOnly ? { availableCopies: { gt: 0 } } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { author: { contains: query.search, mode: 'insensitive' } },
              { isbn: { contains: query.search } },
              { publisher: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.book.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: query.buildOrderBy(['title', 'author', 'createdAt'] as const, 'title'),
        include: {
          category: { select: { id: true, name: true, code: true } },
          _count: { select: { copies: true } },
        },
      }),
      this.prisma.book.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map(({ _count, ...book }) => ({
        ...book,
        copyCount: _count.copies,
        isAvailable: book.availableCopies > 0,
      })),
      total,
      query.page,
      query.limit,
    );
  }

  async getBook(schoolId: string, id: string) {
    const book = await this.prisma.book.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: {
        category: { select: { id: true, name: true } },
        copies: {
          orderBy: { accessionNumber: 'asc' },
          select: {
            id: true,
            accessionNumber: true,
            status: true,
            condition: true,
            rackLocation: true,
            issues: {
              where: { status: { in: [LibraryIssueStatus.ISSUED, LibraryIssueStatus.OVERDUE] } },
              take: 1,
              select: {
                id: true,
                dueDate: true,
                student: {
                  select: { id: true, admissionNumber: true, firstName: true, lastName: true },
                },
              },
            },
          },
        },
      },
    });

    if (!book) throw new NotFoundError('Book');

    return {
      ...book,
      copies: book.copies.map(({ issues, ...copy }) => ({
        ...copy,
        currentIssue: issues[0] ?? null,
      })),
    };
  }

  async createBook(schoolId: string, dto: CreateBookDto) {
    if (dto.isbn) {
      const duplicate = await this.prisma.book.count({
        where: { schoolId, isbn: dto.isbn, deletedAt: null },
      });
      if (duplicate > 0) {
        throw new ConflictError(`A book with ISBN ${dto.isbn} is already catalogued`);
      }
    }

    const book = await this.prisma.transaction(async (tx) => {
      // Accession numbers come from the school's counter, so they stay unique
      // however many copies the library holds and whoever catalogues in parallel.
      const accessions = await this.sequences.nextBatch(
        schoolId,
        'ACCESSION',
        dto.copies,
        {},
        tx,
      );

      return tx.book.create({
        data: {
          schoolId,
          categoryId: dto.categoryId ?? null,
          title: dto.title,
          subtitle: dto.subtitle ?? null,
          author: dto.author,
          coAuthors: dto.coAuthors ?? [],
          publisher: dto.publisher ?? null,
          isbn: dto.isbn ?? null,
          edition: dto.edition ?? null,
          language: dto.language ?? 'English',
          publishYear: dto.publishYear ?? null,
          pages: dto.pages ?? null,
          description: dto.description ?? null,
          coverImageUrl: dto.coverImageUrl ?? null,
          rackLocation: dto.rackLocation ?? null,
          price: dto.price ?? null,
          totalCopies: dto.copies,
          availableCopies: dto.copies,
          copies: {
            create: accessions.map((accessionNumber) => ({
              accessionNumber,
              status: BookCopyStatus.AVAILABLE,
              condition: 'GOOD',
              price: dto.price ?? null,
              rackLocation: dto.rackLocation ?? null,
            })),
          },
        },
        include: { copies: { select: { id: true, accessionNumber: true } } },
      });
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'library',
      entity: 'Book',
      entityId: book.id,
      description: `Catalogued "${book.title}" with ${dto.copies} copy(ies)`,
      schoolId,
    });

    return book;
  }

  async addCopies(schoolId: string, bookId: string, count: number) {
    const book = await this.prisma.book.findFirst({
      where: { id: bookId, schoolId, deletedAt: null },
      select: { id: true, title: true, totalCopies: true },
    });
    if (!book) throw new NotFoundError('Book');

    await this.prisma.transaction(async (tx) => {
      const accessions = await this.sequences.nextBatch(schoolId, 'ACCESSION', count, {}, tx);

      await tx.bookCopy.createMany({
        data: accessions.map((accessionNumber) => ({
          bookId,
          accessionNumber,
          status: BookCopyStatus.AVAILABLE,
          condition: 'GOOD',
        })),
      });
      await this.refreshCounts(tx, bookId);
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'library',
      entity: 'Book',
      entityId: bookId,
      description: `Added ${count} copy(ies) of "${book.title}"`,
      schoolId,
    });

    return this.getBook(schoolId, bookId);
  }

  // -------------------------------------------------------------------------
  // Issue and return
  // -------------------------------------------------------------------------

  /**
   * Issues a copy to a borrower.
   *
   * The borrowing limit, outstanding fines and copy availability are all checked
   * inside the transaction, so two librarians cannot hand out the same copy.
   */
  async issue(schoolId: string, dto: IssueBookDto, issuedById: string) {
    const settings = await this.getSettings(schoolId);
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { timezone: true, name: true },
    });
    const today = todayInZone(school.timezone);

    if (!dto.studentId && !dto.staffId) {
      throw new BadRequestError('A borrower must be specified');
    }

    const issue = await this.prisma.transaction(async (tx) => {
      // Resolve the copy: either the one asked for, or any free copy of the book.
      const copy = dto.bookCopyId
        ? await tx.bookCopy.findFirst({
            where: { id: dto.bookCopyId, book: { schoolId } },
            select: {
              id: true,
              status: true,
              accessionNumber: true,
              bookId: true,
              book: { select: { title: true } },
            },
          })
        : await tx.bookCopy.findFirst({
            where: {
              bookId: dto.bookId,
              status: BookCopyStatus.AVAILABLE,
              book: { schoolId },
            },
            select: {
              id: true,
              status: true,
              accessionNumber: true,
              bookId: true,
              book: { select: { title: true } },
            },
          });

      if (!copy) {
        throw new NotFoundError('An available copy of this book');
      }
      if (copy.status !== BookCopyStatus.AVAILABLE) {
        throw new ConflictError(
          `Copy ${copy.accessionNumber} is currently ${copy.status.toLowerCase()}`,
          ErrorCode.BOOK_NOT_AVAILABLE,
        );
      }

      // Borrowing limit.
      const activeLoans = await tx.libraryIssue.count({
        where: {
          schoolId,
          ...(dto.studentId ? { studentId: dto.studentId } : { staffId: dto.staffId! }),
          status: { in: [LibraryIssueStatus.ISSUED, LibraryIssueStatus.OVERDUE] },
        },
      });

      const membership = dto.studentId
        ? await tx.libraryMembership.findUnique({
            where: { studentId: dto.studentId },
            select: { id: true, maxBooks: true, maxDays: true, isActive: true },
          })
        : null;

      const maxBooks = membership?.maxBooks ?? settings.maxBooksPerStudent;

      if (activeLoans >= maxBooks) {
        throw new ConflictError(
          `The borrowing limit of ${maxBooks} book(s) has been reached`,
          ErrorCode.BOOK_LIMIT_REACHED,
        );
      }

      // An unpaid fine blocks further borrowing.
      const unpaidFines = await tx.libraryFine.aggregate({
        where: {
          isSettled: false,
          issue: {
            schoolId,
            ...(dto.studentId ? { studentId: dto.studentId } : { staffId: dto.staffId! }),
          },
        },
        _sum: { amount: true, paidAmount: true, waivedAmount: true },
      });

      const outstanding =
        Number(unpaidFines._sum.amount ?? 0) -
        Number(unpaidFines._sum.paidAmount ?? 0) -
        Number(unpaidFines._sum.waivedAmount ?? 0);

      if (outstanding > 0) {
        throw new ConflictError(
          `An outstanding library fine of ${outstanding.toFixed(2)} must be settled first`,
        );
      }

      const loanDays = dto.days ?? membership?.maxDays ?? settings.loanDurationDays;
      const dueDate = addDays(today, loanDays);

      const created = await tx.libraryIssue.create({
        data: {
          schoolId,
          bookCopyId: copy.id,
          membershipId: membership?.id ?? null,
          studentId: dto.studentId ?? null,
          staffId: dto.staffId ?? null,
          issueDate: today,
          dueDate,
          status: LibraryIssueStatus.ISSUED,
          issuedById,
          remarks: dto.remarks ?? null,
        },
        select: { id: true, dueDate: true, issueDate: true },
      });

      await tx.bookCopy.update({
        where: { id: copy.id },
        data: { status: BookCopyStatus.ISSUED },
      });

      await this.refreshCounts(tx, copy.bookId);

      return { ...created, copy, loanDays };
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'library',
      entity: 'LibraryIssue',
      entityId: issue.id,
      description:
        `Issued "${issue.copy.book.title}" (${issue.copy.accessionNumber}), ` +
        `due ${formatDate(issue.dueDate)}`,
      schoolId,
    });

    return {
      id: issue.id,
      bookTitle: issue.copy.book.title,
      accessionNumber: issue.copy.accessionNumber,
      issueDate: issue.issueDate,
      dueDate: issue.dueDate,
      loanDays: issue.loanDays,
    };
  }

  /**
   * Records a return and raises a fine for any overdue days, or for a copy
   * returned lost or damaged.
   */
  async returnBook(schoolId: string, issueId: string, dto: ReturnBookDto, receivedById: string) {
    const settings = await this.getSettings(schoolId);
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { timezone: true },
    });
    const today = todayInZone(school.timezone);

    const issue = await this.prisma.libraryIssue.findFirst({
      where: { id: issueId, schoolId },
      select: {
        id: true,
        status: true,
        dueDate: true,
        bookCopyId: true,
        studentId: true,
        bookCopy: {
          select: { id: true, accessionNumber: true, bookId: true, price: true, book: { select: { title: true, price: true } } },
        },
      },
    });
    if (!issue) throw new NotFoundError('Library issue');

    if (issue.status === LibraryIssueStatus.RETURNED) {
      throw new BadRequestError('This book has already been returned');
    }

    const daysLate = Math.max(
      0,
      Math.floor((today.getTime() - issue.dueDate.getTime()) / 86_400_000),
    );

    const result = await this.prisma.transaction(async (tx) => {
      const isLost = dto.condition === 'LOST';
      const isDamaged = dto.condition === 'DAMAGED';

      await tx.libraryIssue.update({
        where: { id: issueId },
        data: {
          status: isLost ? LibraryIssueStatus.LOST : LibraryIssueStatus.RETURNED,
          returnDate: today,
          receivedById,
          remarks: dto.remarks ?? undefined,
        },
      });

      await tx.bookCopy.update({
        where: { id: issue.bookCopyId },
        data: {
          status: isLost
            ? BookCopyStatus.LOST
            : isDamaged
              ? BookCopyStatus.DAMAGED
              : BookCopyStatus.AVAILABLE,
          condition: dto.condition ?? 'GOOD',
        },
      });

      await this.refreshCounts(tx, issue.bookCopy.bookId);

      const fines: Array<{ reason: string; amount: number }> = [];

      // Overdue fine.
      if (daysLate > 0) {
        const amount = Number((daysLate * settings.finePerDay).toFixed(2));
        await tx.libraryFine.create({
          data: {
            issueId,
            reason: 'OVERDUE',
            amount,
            notes: `${daysLate} day(s) overdue at ${settings.finePerDay} per day`,
          },
        });
        fines.push({ reason: 'OVERDUE', amount });
      }

      // Replacement cost for a lost or damaged copy.
      if (isLost || isDamaged) {
        const bookPrice = Number(issue.bookCopy.price ?? issue.bookCopy.book.price ?? 0);
        const amount = dto.replacementCost ?? (isLost ? bookPrice : bookPrice * 0.5);

        if (amount > 0) {
          await tx.libraryFine.create({
            data: {
              issueId,
              reason: isLost ? 'LOST' : 'DAMAGE',
              amount: Number(amount.toFixed(2)),
              notes: isLost ? 'Replacement cost' : 'Damage charge',
            },
          });
          fines.push({ reason: isLost ? 'LOST' : 'DAMAGE', amount: Number(amount.toFixed(2)) });
        }
      }

      return { fines, daysLate };
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'library',
      entity: 'LibraryIssue',
      entityId: issueId,
      description:
        `Returned "${issue.bookCopy.book.title}" (${issue.bookCopy.accessionNumber})` +
        (result.daysLate > 0 ? `, ${result.daysLate} day(s) late` : '') +
        (result.fines.length > 0
          ? `; fines: ${result.fines.map((fine) => `${fine.reason} ${fine.amount}`).join(', ')}`
          : ''),
      schoolId,
    });

    return {
      returned: true,
      daysLate: result.daysLate,
      fines: result.fines,
      totalFine: result.fines.reduce((sum, fine) => sum + fine.amount, 0),
    };
  }

  /** Extends a loan, within the renewal limit and only if not already overdue. */
  async renew(schoolId: string, issueId: string) {
    const settings = await this.getSettings(schoolId);
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { timezone: true },
    });
    const today = todayInZone(school.timezone);

    const issue = await this.prisma.libraryIssue.findFirst({
      where: { id: issueId, schoolId },
      select: {
        id: true,
        status: true,
        dueDate: true,
        renewalCount: true,
        bookCopy: { select: { book: { select: { title: true } } } },
      },
    });
    if (!issue) throw new NotFoundError('Library issue');

    if (issue.status !== LibraryIssueStatus.ISSUED) {
      throw new BadRequestError(`A ${issue.status.toLowerCase()} loan cannot be renewed`);
    }
    if (issue.renewalCount >= settings.maxRenewals) {
      throw new BadRequestError(
        `This loan has already been renewed ${settings.maxRenewals} time(s)`,
      );
    }
    if (issue.dueDate < today) {
      throw new BadRequestError(
        'This loan is already overdue and must be returned before it can be renewed',
      );
    }

    const newDueDate = addDays(issue.dueDate, settings.loanDurationDays);

    // The loan stays ISSUED after a renewal — renewalCount is what records it.
    // Parking it in RENEWED would hide it from the active-loan and overdue
    // queries, which both filter on ISSUED/OVERDUE.
    const updated = await this.prisma.libraryIssue.update({
      where: { id: issueId },
      data: {
        dueDate: newDueDate,
        renewalCount: { increment: 1 },
        status: LibraryIssueStatus.ISSUED,
      },
      select: { id: true, dueDate: true, renewalCount: true, status: true },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'library',
      entity: 'LibraryIssue',
      entityId: issueId,
      description: `Renewed "${issue.bookCopy.book.title}" until ${formatDate(newDueDate)}`,
      schoolId,
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // Circulation views
  // -------------------------------------------------------------------------

  async listIssues(
    schoolId: string,
    query: PaginationQueryDto & {
      status?: LibraryIssueStatus;
      studentId?: string;
      overdueOnly?: boolean;
    },
  ) {
    const where: Prisma.LibraryIssueWhereInput = {
      schoolId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.overdueOnly
        ? {
            status: { in: [LibraryIssueStatus.ISSUED, LibraryIssueStatus.OVERDUE] },
            dueDate: { lt: new Date() },
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.libraryIssue.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { issueDate: 'desc' },
        include: {
          bookCopy: {
            select: {
              accessionNumber: true,
              book: { select: { id: true, title: true, author: true, coverImageUrl: true } },
            },
          },
          student: {
            select: {
              id: true,
              admissionNumber: true,
              firstName: true,
              lastName: true,
              enrollments: {
                where: { status: 'ACTIVE' },
                take: 1,
                select: {
                  class: { select: { name: true } },
                  section: { select: { name: true } },
                },
              },
            },
          },
          fines: { select: { id: true, reason: true, amount: true, isSettled: true } },
        },
      }),
      this.prisma.libraryIssue.count({ where }),
    ]);

    const now = new Date();

    return buildPaginatedResult(
      items.map((issue) => ({
        ...issue,
        daysOverdue:
          issue.dueDate < now && !issue.returnDate
            ? Math.floor((now.getTime() - issue.dueDate.getTime()) / 86_400_000)
            : 0,
        outstandingFine: issue.fines
          .filter((fine) => !fine.isSettled)
          .reduce((sum, fine) => sum + Number(fine.amount), 0),
      })),
      total,
      query.page,
      query.limit,
    );
  }

  /** A borrower's history and current loans. */
  async borrowerHistory(schoolId: string, studentId: string) {
    const [issues, membership, fines] = await this.prisma.$transaction([
      this.prisma.libraryIssue.findMany({
        where: { schoolId, studentId },
        orderBy: { issueDate: 'desc' },
        take: 100,
        include: {
          bookCopy: {
            select: {
              accessionNumber: true,
              book: { select: { id: true, title: true, author: true, coverImageUrl: true } },
            },
          },
          fines: true,
        },
      }),
      this.prisma.libraryMembership.findUnique({ where: { studentId } }),
      this.prisma.libraryFine.aggregate({
        where: { isSettled: false, issue: { studentId } },
        _sum: { amount: true, paidAmount: true, waivedAmount: true },
      }),
    ]);

    const active = issues.filter(
      (issue) =>
        issue.status === LibraryIssueStatus.ISSUED ||
        issue.status === LibraryIssueStatus.OVERDUE,
    );

    return {
      membership,
      currentLoans: active.length,
      maxBooks: membership?.maxBooks ?? DEFAULT_SETTINGS.maxBooksPerStudent,
      outstandingFine:
        Number(fines._sum.amount ?? 0) -
        Number(fines._sum.paidAmount ?? 0) -
        Number(fines._sum.waivedAmount ?? 0),
      totalBorrowed: issues.length,
      issues,
    };
  }

  // -------------------------------------------------------------------------
  // Fines
  // -------------------------------------------------------------------------

  async listFines(schoolId: string, settled?: boolean) {
    return this.prisma.libraryFine.findMany({
      where: {
        issue: { schoolId },
        ...(settled !== undefined ? { isSettled: settled } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        issue: {
          select: {
            id: true,
            dueDate: true,
            returnDate: true,
            bookCopy: {
              select: { accessionNumber: true, book: { select: { title: true } } },
            },
            student: {
              select: { id: true, admissionNumber: true, firstName: true, lastName: true },
            },
          },
        },
      },
    });
  }

  async settleFine(schoolId: string, fineId: string, amount: number) {
    const fine = await this.prisma.libraryFine.findFirst({
      where: { id: fineId, issue: { schoolId } },
      select: { id: true, amount: true, paidAmount: true, waivedAmount: true, isSettled: true },
    });
    if (!fine) throw new NotFoundError('Fine');

    if (fine.isSettled) {
      throw new BadRequestError('This fine has already been settled');
    }

    const due =
      Number(fine.amount) - Number(fine.paidAmount) - Number(fine.waivedAmount);

    if (amount > due) {
      throw new BadRequestError(`Only ${due.toFixed(2)} remains due on this fine`);
    }

    const paid = Number(fine.paidAmount) + amount;
    const settled = paid + Number(fine.waivedAmount) >= Number(fine.amount);

    const updated = await this.prisma.libraryFine.update({
      where: { id: fineId },
      data: {
        paidAmount: paid,
        isSettled: settled,
        settledAt: settled ? new Date() : null,
      },
    });

    this.audit.record({
      action: AuditAction.PAYMENT,
      module: 'library',
      entity: 'LibraryFine',
      entityId: fineId,
      description: `Collected ${amount.toFixed(2)} against a library fine`,
      schoolId,
    });

    return updated;
  }

  async waiveFine(schoolId: string, fineId: string, dto: WaiveFineDto, waivedById: string) {
    const fine = await this.prisma.libraryFine.findFirst({
      where: { id: fineId, issue: { schoolId } },
      select: { id: true, amount: true, paidAmount: true, waivedAmount: true, isSettled: true },
    });
    if (!fine) throw new NotFoundError('Fine');

    const due = Number(fine.amount) - Number(fine.paidAmount) - Number(fine.waivedAmount);
    const waiveAmount = dto.amount ?? due;

    if (waiveAmount > due) {
      throw new BadRequestError(`Only ${due.toFixed(2)} remains to be waived`);
    }

    const waived = Number(fine.waivedAmount) + waiveAmount;
    const settled = Number(fine.paidAmount) + waived >= Number(fine.amount);

    const updated = await this.prisma.libraryFine.update({
      where: { id: fineId },
      data: {
        waivedAmount: waived,
        isSettled: settled,
        settledAt: settled ? new Date() : null,
        waivedById,
        notes: dto.reason,
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'library',
      entity: 'LibraryFine',
      entityId: fineId,
      description: `Waived ${waiveAmount.toFixed(2)} of a library fine: ${dto.reason}`,
      schoolId,
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // Scheduled work
  // -------------------------------------------------------------------------

  /**
   * Flags overdue loans and reminds the borrower. Run daily.
   * Idempotent: a loan already marked overdue is not re-notified.
   */
  async scanOverdue(schoolId: string): Promise<{ flagged: number; notified: number }> {
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { timezone: true, name: true },
    });
    const today = todayInZone(school.timezone);

    const newlyOverdue = await this.prisma.libraryIssue.findMany({
      where: { schoolId, status: LibraryIssueStatus.ISSUED, dueDate: { lt: today } },
      select: {
        id: true,
        dueDate: true,
        student: {
          select: {
            firstName: true,
            lastName: true,
            userId: true,
            guardians: { select: { guardian: { select: { userId: true } } } },
          },
        },
        bookCopy: { select: { book: { select: { title: true } } } },
      },
    });

    if (newlyOverdue.length === 0) return { flagged: 0, notified: 0 };

    await this.prisma.libraryIssue.updateMany({
      where: { id: { in: newlyOverdue.map((issue) => issue.id) } },
      data: { status: LibraryIssueStatus.OVERDUE },
    });

    let notified = 0;

    for (const issue of newlyOverdue) {
      const recipients = [
        ...(issue.student?.userId ? [issue.student.userId] : []),
        ...(issue.student?.guardians ?? [])
          .map((link) => link.guardian.userId)
          .filter((id): id is string => Boolean(id)),
      ];

      if (recipients.length === 0) continue;

      await this.notifications
        .dispatch({
          schoolId,
          userIds: recipients,
          type: NotificationType.LIBRARY,
          title: 'Library book overdue',
          body: `"${issue.bookCopy.book.title}" was due on ${formatDate(issue.dueDate)}. Please return it to avoid a fine.`,
          data: { issueId: issue.id },
          actionUrl: '/library/my-books',
        })
        .catch(() => undefined);

      notified += 1;
    }

    this.log.info('Overdue library loans flagged', {
      schoolId,
      flagged: newlyOverdue.length,
      notified,
    });

    return { flagged: newlyOverdue.length, notified };
  }

  async statistics(schoolId: string) {
    const [titles, copies, available, issued, overdue, fines] = await this.prisma.$transaction([
      this.prisma.book.count({ where: { schoolId, deletedAt: null } }),
      this.prisma.bookCopy.count({ where: { book: { schoolId } } }),
      this.prisma.bookCopy.count({
        where: { book: { schoolId }, status: BookCopyStatus.AVAILABLE },
      }),
      this.prisma.libraryIssue.count({
        where: {
          schoolId,
          status: { in: [LibraryIssueStatus.ISSUED, LibraryIssueStatus.OVERDUE] },
        },
      }),
      this.prisma.libraryIssue.count({
        where: { schoolId, status: LibraryIssueStatus.OVERDUE },
      }),
      this.prisma.libraryFine.aggregate({
        where: { isSettled: false, issue: { schoolId } },
        _sum: { amount: true, paidAmount: true, waivedAmount: true },
      }),
    ]);

    return {
      titles,
      copies,
      currentlyIssued: issued,
      overdue,
      available,
      unavailable: copies - available - issued,
      outstandingFines:
        Number(fines._sum.amount ?? 0) -
        Number(fines._sum.paidAmount ?? 0) -
        Number(fines._sum.waivedAmount ?? 0),
    };
  }

  // -------------------------------------------------------------------------

  /** Keeps the denormalised copy counters honest after any change. */
  private async refreshCounts(tx: TransactionClient, bookId: string): Promise<void> {
    const copies = await tx.bookCopy.findMany({
      where: { bookId },
      select: { status: true },
    });

    await tx.book.update({
      where: { id: bookId },
      data: {
        totalCopies: copies.length,
        availableCopies: copies.filter((copy) => copy.status === BookCopyStatus.AVAILABLE).length,
      },
    });
  }

  private async getSettings(schoolId: string): Promise<LibrarySettings> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { settings: true },
    });
    const stored = (school?.settings as { library?: Partial<LibrarySettings> } | null)?.library;
    return { ...DEFAULT_SETTINGS, ...stored };
  }
}
