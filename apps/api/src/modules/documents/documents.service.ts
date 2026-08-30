import { Injectable } from '@nestjs/common';
import { AuditAction, DocumentOwnerType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { buildPaginatedResult } from '../../common/dto/api-response.dto';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../common/exceptions/app.exception';
import { addDays, parseDateOnly, todayInZone } from '../../common/utils/date.util';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import type {
  CreateCategoryDto,
  DocumentQueryDto,
  UpdateDocumentDto,
  UploadDocumentDto,
  VerifyDocumentDto,
} from './dto/documents.dto';

/** Which id an owner type requires. GENERIC, SCHOOL and CLASS need none. */
const REQUIRED_OWNER_ID: Partial<Record<DocumentOwnerType, 'studentId' | 'staffId' | 'guardianId'>> =
  {
    STUDENT: 'studentId',
    STAFF: 'staffId',
    PARENT: 'guardianId',
  };

@Injectable()
export class DocumentsService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('DocumentsService');
  }

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  async listCategories(schoolId: string, ownerType?: DocumentOwnerType) {
    const categories = await this.prisma.documentCategory.findMany({
      where: {
        OR: [{ schoolId }, { schoolId: null }],
        ...(ownerType ? { ownerType } : {}),
      },
      orderBy: [{ ownerType: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { documents: true } } },
    });

    return categories.map(({ _count, ...category }) => ({
      ...category,
      documentCount: _count.documents,
      isShared: category.schoolId === null,
    }));
  }

  async createCategory(schoolId: string, dto: CreateCategoryDto) {
    const clash = await this.prisma.documentCategory.count({
      where: { schoolId, code: dto.code },
    });
    if (clash > 0) {
      throw new ConflictError(`A category with the code "${dto.code}" already exists.`);
    }

    const category = await this.prisma.documentCategory.create({
      data: {
        schoolId,
        name: dto.name,
        code: dto.code,
        ownerType: dto.ownerType ?? DocumentOwnerType.GENERIC,
        isRequired: dto.isRequired ?? false,
        hasExpiry: dto.hasExpiry ?? false,
      },
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'documents',
      entity: 'DocumentCategory',
      entityId: category.id,
      description: `Created document category "${category.name}"`,
      schoolId,
    });

    return category;
  }

  async deleteCategory(schoolId: string, id: string) {
    const category = await this.prisma.documentCategory.findFirst({
      where: { id, schoolId },
      include: { _count: { select: { documents: true } } },
    });
    if (!category) throw new NotFoundError('Document category');
    if (category._count.documents > 0) {
      throw new ConflictError(
        `This category holds ${category._count.documents} document(s). Move them before deleting it.`,
      );
    }

    await this.prisma.documentCategory.delete({ where: { id } });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'documents',
      entity: 'DocumentCategory',
      entityId: id,
      description: `Deleted document category "${category.name}"`,
      schoolId,
    });

    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------

  async statistics(schoolId: string) {
    const today = todayInZone();
    const soon = addDays(today, 30);

    const [total, unverified, expired, expiringSoon, sizeAgg] = await Promise.all([
      this.prisma.document.count({ where: { schoolId, deletedAt: null } }),
      this.prisma.document.count({ where: { schoolId, deletedAt: null, isVerified: false } }),
      this.prisma.document.count({
        where: { schoolId, deletedAt: null, expiryDate: { lt: today } },
      }),
      this.prisma.document.count({
        where: { schoolId, deletedAt: null, expiryDate: { gte: today, lte: soon } },
      }),
      this.prisma.document.aggregate({
        where: { schoolId, deletedAt: null },
        _sum: { sizeBytes: true },
      }),
    ]);

    return {
      total,
      unverified,
      expired,
      expiringSoon,
      storageBytes: sizeAgg._sum.sizeBytes ?? 0,
    };
  }

  async list(schoolId: string, query: DocumentQueryDto) {
    const today = todayInZone();

    const where: Prisma.DocumentWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.ownerType ? { ownerType: query.ownerType } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.staffId ? { staffId: query.staffId } : {}),
      ...(query.guardianId ? { guardianId: query.guardianId } : {}),
      ...(query.unverifiedOnly ? { isVerified: false } : {}),
      ...(query.expiredOnly ? { expiryDate: { lt: today } } : {}),
      ...(query.expiringWithinDays !== undefined && !query.expiredOnly
        ? { expiryDate: { gte: today, lte: addDays(today, query.expiringWithinDays) } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { fileName: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: query.buildOrderBy(
          ['createdAt', 'title', 'expiryDate', 'sizeBytes'] as const,
          'createdAt',
        ),
        include: {
          category: { select: { id: true, name: true, code: true } },
          student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } },
          staff: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
          guardian: { select: { id: true, firstName: true, lastName: true } },
          uploadedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.document.count({ where }),
    ]);

    return buildPaginatedResult(
      items.map((document) => this.decorate(document, today)),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(schoolId: string, id: string) {
    const document = await this.prisma.document.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: {
        category: { select: { id: true, name: true, code: true } },
        student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } },
        staff: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
        guardian: { select: { id: true, firstName: true, lastName: true } },
        uploadedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!document) throw new NotFoundError('Document');

    return this.decorate(document, todayInZone());
  }

  /**
   * Stores an uploaded file and records it.
   *
   * The storage write happens first and is rolled back by hand if the database
   * row cannot be created, so a failed upload does not leave an orphaned object
   * sitting in the bucket forever.
   */
  async upload(
    schoolId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
    dto: UploadDocumentDto,
    userId: string,
  ) {
    if (!file) throw new BadRequestError('Attach a file to upload.');

    await this.assertOwner(schoolId, dto);
    if (dto.categoryId) await this.assertCategory(schoolId, dto.categoryId);

    if (dto.issueDate && dto.expiryDate && parseDateOnly(dto.expiryDate) < parseDateOnly(dto.issueDate)) {
      throw new BadRequestError('The expiry date cannot fall before the issue date.');
    }

    const stored = await this.storage.upload({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder: `schools/${schoolId}/documents/${dto.ownerType.toLowerCase()}`,
      schoolId,
      isPublic: dto.isPublic ?? false,
    });

    try {
      const document = await this.prisma.document.create({
        data: {
          schoolId,
          categoryId: dto.categoryId ?? null,
          ownerType: dto.ownerType,
          studentId: dto.studentId ?? null,
          staffId: dto.staffId ?? null,
          guardianId: dto.guardianId ?? null,
          title: dto.title,
          description: dto.description ?? null,
          fileName: stored.fileName,
          storageKey: stored.storageKey,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          checksum: stored.checksum,
          isPublic: dto.isPublic ?? false,
          issueDate: dto.issueDate ? parseDateOnly(dto.issueDate) : null,
          expiryDate: dto.expiryDate ? parseDateOnly(dto.expiryDate) : null,
          uploadedById: userId,
        },
      });

      this.audit.record({
        action: AuditAction.CREATE,
        module: 'documents',
        entity: 'Document',
        entityId: document.id,
        description: `Uploaded "${document.title}" (${stored.fileName})`,
        userId,
        schoolId,
      });

      return this.findOne(schoolId, document.id);
    } catch (error) {
      await this.storage.delete(stored.storageKey).catch(() => {
        this.log.warn('Orphaned upload could not be cleaned up', {
          schoolId,
          storageKey: stored.storageKey,
        });
      });
      throw error;
    }
  }

  async update(schoolId: string, id: string, dto: UpdateDocumentDto, userId: string) {
    const existing = await this.prisma.document.findFirst({
      where: { id, schoolId, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Document');

    if (dto.categoryId) await this.assertCategory(schoolId, dto.categoryId);

    const issueDate = dto.issueDate ? parseDateOnly(dto.issueDate) : existing.issueDate;
    const expiryDate = dto.expiryDate ? parseDateOnly(dto.expiryDate) : existing.expiryDate;
    if (issueDate && expiryDate && expiryDate < issueDate) {
      throw new BadRequestError('The expiry date cannot fall before the issue date.');
    }

    await this.prisma.document.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.issueDate !== undefined ? { issueDate } : {}),
        ...(dto.expiryDate !== undefined ? { expiryDate } : {}),
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'documents',
      entity: 'Document',
      entityId: id,
      description: `Updated document "${existing.title}"`,
      userId,
      schoolId,
    });

    return this.findOne(schoolId, id);
  }

  /** Marks a document as checked by a member of staff, or sends it back. */
  async verify(schoolId: string, id: string, dto: VerifyDocumentDto, userId: string) {
    const existing = await this.prisma.document.findFirst({
      where: { id, schoolId, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Document');

    await this.prisma.document.update({
      where: { id },
      data: {
        isVerified: dto.isVerified,
        verifiedById: dto.isVerified ? userId : null,
        verifiedAt: dto.isVerified ? new Date() : null,
      },
    });

    this.audit.record({
      action: AuditAction.UPDATE,
      module: 'documents',
      entity: 'Document',
      entityId: id,
      description: dto.isVerified
        ? `Verified document "${existing.title}"`
        : `Withdrew verification of "${existing.title}"`,
      userId,
      schoolId,
    });

    return this.findOne(schoolId, id);
  }

  /**
   * Reads the stored file back for streaming.
   *
   * The bytes go through the API rather than a signed storage URL: the local
   * disk driver has no signing to offer, and a browser opening a link cannot
   * send the bearer token the API expects. Streaming keeps one code path that
   * works on every driver and keeps the access check on the request.
   */
  async readFile(schoolId: string, id: string, userId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id, schoolId, deletedAt: null },
      select: { id: true, title: true, fileName: true, storageKey: true, mimeType: true },
    });
    if (!document) throw new NotFoundError('Document');

    const buffer = await this.storage.download(document.storageKey);

    // Recorded as an export: who took a copy of a personal document out of the
    // system is exactly the question an audit of this module has to answer.
    this.audit.record({
      action: AuditAction.EXPORT,
      module: 'documents',
      entity: 'Document',
      entityId: id,
      description: `Downloaded "${document.title}"`,
      userId,
      schoolId,
    });

    return { buffer, fileName: document.fileName, mimeType: document.mimeType };
  }

  /**
   * Soft-deletes a document.
   *
   * The stored object is left in place: documents are records, and a delete
   * made by mistake has to be recoverable. A retention job clears the bytes.
   */
  async remove(schoolId: string, id: string, userId: string) {
    const existing = await this.prisma.document.findFirst({
      where: { id, schoolId, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Document');

    await this.prisma.document.update({ where: { id }, data: { deletedAt: new Date() } });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'documents',
      entity: 'Document',
      entityId: id,
      description: `Deleted document "${existing.title}"`,
      userId,
      schoolId,
    });

    return { deleted: true };
  }

  /**
   * Which required categories a person has not supplied yet.
   *
   * Used by the student and staff detail screens to show a checklist rather
   * than an undifferentiated pile of files.
   */
  async missingRequired(
    schoolId: string,
    ownerType: DocumentOwnerType,
    ownerId: string,
  ): Promise<Array<{ id: string; name: string; code: string }>> {
    const ownerKey = REQUIRED_OWNER_ID[ownerType];
    if (!ownerKey) return [];

    const [required, held] = await Promise.all([
      this.prisma.documentCategory.findMany({
        where: { OR: [{ schoolId }, { schoolId: null }], ownerType, isRequired: true },
        select: { id: true, name: true, code: true },
      }),
      this.prisma.document.findMany({
        where: { schoolId, deletedAt: null, [ownerKey]: ownerId },
        select: { categoryId: true },
      }),
    ]);

    const heldIds = new Set(held.map((document) => document.categoryId));
    return required.filter((category) => !heldIds.has(category.id));
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async assertOwner(schoolId: string, dto: UploadDocumentDto): Promise<void> {
    const ownerKey = REQUIRED_OWNER_ID[dto.ownerType];
    if (!ownerKey) return;

    const ownerId = dto[ownerKey];
    if (!ownerId) {
      throw new BadRequestError(`A ${dto.ownerType.toLowerCase()} document must name its owner.`);
    }

    const exists =
      ownerKey === 'studentId'
        ? await this.prisma.student.count({ where: { id: ownerId, schoolId, deletedAt: null } })
        : ownerKey === 'staffId'
          ? await this.prisma.staff.count({ where: { id: ownerId, schoolId, deletedAt: null } })
          : await this.prisma.guardian.count({ where: { id: ownerId, schoolId } });

    if (exists === 0) {
      throw new BadRequestError('The record this document belongs to does not exist.');
    }
  }

  private async assertCategory(schoolId: string, categoryId: string): Promise<void> {
    const category = await this.prisma.documentCategory.count({
      where: { id: categoryId, OR: [{ schoolId }, { schoolId: null }] },
    });
    if (category === 0) throw new BadRequestError('The selected category does not exist.');
  }

  private decorate<
    T extends {
      expiryDate: Date | null;
      student?: { firstName: string; lastName: string | null } | null;
      staff?: { firstName: string; lastName: string | null } | null;
      guardian?: { firstName: string; lastName: string | null } | null;
    },
  >(document: T, today: Date) {
    const owner = document.student ?? document.staff ?? document.guardian ?? null;

    return {
      ...document,
      ownerName: owner ? [owner.firstName, owner.lastName].filter(Boolean).join(' ') : null,
      isExpired: document.expiryDate !== null && document.expiryDate < today,
      daysUntilExpiry:
        document.expiryDate === null
          ? null
          : Math.ceil((document.expiryDate.getTime() - today.getTime()) / 86_400_000),
    };
  }
}
