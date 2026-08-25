import { Injectable } from '@nestjs/common';
import { AuditAction, NoticeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { ConflictError, NotFoundError } from '../../common/exceptions/app.exception';
import { parseDateOnly } from '../../common/utils/date.util';
import { AuditService } from '../audit/audit.service';
import { SequenceService } from '../../common/services/sequence.service';
import type {
  PublicEnquiryDto,
  UpsertGalleryAlbumDto,
  UpsertWebsitePageDto,
} from './dto/website.dto';

/** Pages the site expects to exist, seeded on first publish. */
export const CORE_PAGES = [
  { slug: 'about', title: 'About Us' },
  { slug: 'principal-message', title: "Principal's Message" },
  { slug: 'academics', title: 'Academics' },
  { slug: 'admissions', title: 'Admissions' },
  { slug: 'facilities', title: 'Facilities' },
] as const;

@Injectable()
export class WebsiteService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequenceService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.log = logger.child('WebsiteService');
  }

  // -------------------------------------------------------------------------
  // Public — served unauthenticated to the marketing site
  // -------------------------------------------------------------------------

  /**
   * Everything the public site needs to render its shell: identity, contact,
   * branding and the menu.
   *
   * Deliberately narrow. This is the one endpoint the whole internet can call,
   * so it exposes only what a visitor would already see printed on a
   * prospectus — never counts, never internal configuration.
   */
  async publicSchool(slug: string) {
    const school = await this.prisma.school.findFirst({
      where: { slug, status: 'ACTIVE', deletedAt: null },
      select: {
        id: true,
        slug: true,
        name: true,
        legalName: true,
        email: true,
        phone: true,
        alternatePhone: true,
        website: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        country: true,
        postalCode: true,
        latitude: true,
        longitude: true,
        board: true,
        affiliationNumber: true,
        establishedYear: true,
        principalName: true,
        logoUrl: true,
        faviconUrl: true,
        primaryColor: true,
        secondaryColor: true,
        settings: true,
      },
    });

    if (!school) throw new NotFoundError('School');

    const [pages, timings] = await Promise.all([
      this.prisma.websitePage.findMany({
        where: { schoolId: school.id, isPublished: true, showInMenu: true },
        orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
        select: { slug: true, title: true },
      }),
      Promise.resolve(
        (school.settings as { timings?: { startTime?: string; endTime?: string } } | null)
          ?.timings ?? null,
      ),
    ]);

    // The raw settings blob carries internal configuration, so only the
    // visitor-facing timings are lifted out of it.
    const { settings: _settings, id: _id, ...publicFields } = school;

    return {
      ...publicFields,
      timings: timings ? { startTime: timings.startTime, endTime: timings.endTime } : null,
      menu: pages,
    };
  }

  async publicPage(slug: string, pageSlug: string) {
    const school = await this.schoolIdBySlug(slug);

    const page = await this.prisma.websitePage.findFirst({
      where: { schoolId: school, slug: pageSlug, isPublished: true },
      select: {
        slug: true,
        title: true,
        content: true,
        excerpt: true,
        coverImageUrl: true,
        metaTitle: true,
        metaDescription: true,
        ogImageUrl: true,
        publishedAt: true,
        updatedAt: true,
      },
    });

    if (!page) throw new NotFoundError('Page');
    return page;
  }

  /** Published notices with a public audience, for the news section. */
  async publicNotices(slug: string, limit = 10) {
    const schoolId = await this.schoolIdBySlug(slug);
    const now = new Date();

    const notices = await this.prisma.notice.findMany({
      where: {
        schoolId,
        status: NoticeStatus.PUBLISHED,
        // A notice aimed at one class is not public business.
        audience: { in: ['ALL', 'PARENTS', 'STUDENTS'] },
        publishAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      },
      orderBy: [{ isPinned: 'desc' }, { publishAt: 'desc' }],
      take: Math.min(50, limit),
      select: {
        id: true,
        title: true,
        body: true,
        priority: true,
        isPinned: true,
        publishAt: true,
      },
    });

    return notices;
  }

  async publicGallery(slug: string) {
    const schoolId = await this.schoolIdBySlug(slug);

    return this.prisma.galleryAlbum.findMany({
      where: { schoolId, isPublished: true },
      orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        coverImageUrl: true,
        eventDate: true,
        _count: { select: { photos: true } },
      },
    });
  }

  async publicAlbum(slug: string, albumSlug: string) {
    const schoolId = await this.schoolIdBySlug(slug);

    const album = await this.prisma.galleryAlbum.findFirst({
      where: { schoolId, slug: albumSlug, isPublished: true },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        eventDate: true,
        photos: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, url: true, caption: true },
        },
      },
    });

    if (!album) throw new NotFoundError('Album');
    return album;
  }

  /**
   * Teaching staff shown on the faculty page.
   *
   * Only name, photo, designation, department and qualification — never a
   * personal phone number or email, which are not the public's business.
   */
  async publicFaculty(slug: string) {
    const schoolId = await this.schoolIdBySlug(slug);

    const staff = await this.prisma.staff.findMany({
      where: { schoolId, employmentStatus: 'ACTIVE', isTeacher: true },
      orderBy: [{ joiningDate: 'asc' }],
      take: 100,
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        photoUrl: true,
        qualification: true,
        specialization: true,
        joiningDate: true,
        designation: { select: { name: true } },
        department: { select: { name: true } },
      },
    });

    const now = Date.now();

    return staff.map((member) => ({
      id: member.id,
      name: [member.firstName, member.middleName, member.lastName].filter(Boolean).join(' '),
      photoUrl: member.photoUrl,
      designation: member.designation?.name ?? null,
      department: member.department?.name ?? null,
      qualification: member.qualification,
      specialization: member.specialization,
      yearsOfService: Math.max(
        0,
        Math.floor((now - member.joiningDate.getTime()) / (365.25 * 86_400_000)),
      ),
    }));
  }

  /** Figures a prospectus would quote, derived rather than hand-maintained. */
  async publicStatistics(slug: string) {
    const schoolId = await this.schoolIdBySlug(slug);

    const [students, teachers, classes, established] = await Promise.all([
      this.prisma.student.count({ where: { schoolId, status: 'ACTIVE', deletedAt: null } }),
      this.prisma.staff.count({ where: { schoolId, employmentStatus: 'ACTIVE', isTeacher: true } }),
      this.prisma.class.count({ where: { schoolId } }),
      this.prisma.school.findUniqueOrThrow({
        where: { id: schoolId },
        select: { establishedYear: true },
      }),
    ]);

    return {
      students,
      teachers,
      classes,
      establishedYear: established.establishedYear,
      // Rounded to the nearest whole number: "1:14" reads better than "1:13.7"
      // and the precision was never meaningful.
      studentTeacherRatio: teachers > 0 ? Math.round(students / teachers) : null,
    };
  }

  /**
   * Records an admission enquiry submitted from the public site.
   *
   * A honeypot hit is answered with the same success response a real applicant
   * gets — telling a bot it was detected only teaches it to try again.
   */
  async submitEnquiry(slug: string, dto: PublicEnquiryDto, ip?: string) {
    const schoolId = await this.schoolIdBySlug(slug);

    if (dto.website) {
      this.log.warn('Admission enquiry rejected as spam', { slug, ip });
      return { submitted: true, enquiryNumber: null };
    }

    // A duplicate submission within the hour is a double-click or a retry, not
    // a second child; return the original rather than creating a twin.
    const recent = await this.prisma.admissionEnquiry.findFirst({
      where: {
        schoolId,
        phone: dto.phone,
        studentFirstName: dto.studentFirstName,
        createdAt: { gte: new Date(Date.now() - 3_600_000) },
      },
      select: { enquiryNumber: true },
    });

    if (recent) {
      return { submitted: true, enquiryNumber: recent.enquiryNumber, duplicate: true };
    }

    const academicYear = await this.prisma.academicYear.findFirst({
      where: { schoolId, isCurrent: true },
      select: { id: true },
    });

    const enquiry = await this.prisma.transaction(async (tx) => {
      const enquiryNumber = await this.sequences.next(schoolId, 'ENQUIRY', {}, tx);

      return tx.admissionEnquiry.create({
        data: {
          schoolId,
          academicYearId: academicYear?.id ?? null,
          enquiryNumber,
          studentFirstName: dto.studentFirstName,
          studentLastName: dto.studentLastName ?? null,
          dateOfBirth: dto.dateOfBirth ? parseDateOnly(dto.dateOfBirth) : null,
          gender: dto.gender ?? null,
          seekingClass: dto.seekingClass,
          previousSchool: dto.previousSchool ?? null,
          parentName: dto.parentName,
          relation: dto.relation ?? 'FATHER',
          phone: dto.phone,
          email: dto.email ?? null,
          addressLine1: dto.addressLine1 ?? null,
          city: dto.city ?? null,
          source: 'WEBSITE',
          notes: dto.notes ?? null,
        },
        select: { id: true, enquiryNumber: true },
      });
    });

    this.audit.record({
      action: AuditAction.CREATE,
      module: 'admissions',
      entity: 'AdmissionEnquiry',
      entityId: enquiry.id,
      description: `Website enquiry ${enquiry.enquiryNumber} for ${dto.studentFirstName} (${dto.seekingClass})`,
      schoolId,
    });

    this.log.info('Admission enquiry received from the website', {
      schoolId,
      enquiryNumber: enquiry.enquiryNumber,
    });

    return { submitted: true, enquiryNumber: enquiry.enquiryNumber };
  }

  /** Slugs the sitemap should list, with their last-modified stamps. */
  async sitemap(slug: string) {
    const schoolId = await this.schoolIdBySlug(slug);

    const [pages, albums] = await Promise.all([
      this.prisma.websitePage.findMany({
        where: { schoolId, isPublished: true },
        select: { slug: true, updatedAt: true },
      }),
      this.prisma.galleryAlbum.findMany({
        where: { schoolId, isPublished: true },
        select: { slug: true, updatedAt: true },
      }),
    ]);

    return { pages, albums };
  }

  // -------------------------------------------------------------------------
  // Administration
  // -------------------------------------------------------------------------

  async listPages(schoolId: string) {
    return this.prisma.websitePage.findMany({
      where: { schoolId },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        isPublished: true,
        showInMenu: true,
        sortOrder: true,
        publishedAt: true,
        updatedAt: true,
      },
    });
  }

  async getPage(schoolId: string, id: string) {
    const page = await this.prisma.websitePage.findFirst({ where: { id, schoolId } });
    if (!page) throw new NotFoundError('Page');
    return page;
  }

  async upsertPage(schoolId: string, dto: UpsertWebsitePageDto, userId: string) {
    const existing = await this.prisma.websitePage.findFirst({
      where: { schoolId, slug: dto.slug },
      select: { id: true, isPublished: true },
    });

    const data = {
      title: dto.title,
      content: (dto.content ?? []) as unknown as Prisma.InputJsonValue,
      excerpt: dto.excerpt ?? null,
      coverImageUrl: dto.coverImageUrl ?? null,
      metaTitle: dto.metaTitle ?? null,
      metaDescription: dto.metaDescription ?? null,
      ogImageUrl: dto.ogImageUrl ?? null,
      isPublished: dto.isPublished ?? false,
      showInMenu: dto.showInMenu ?? true,
      sortOrder: dto.sortOrder ?? 0,
      updatedById: userId,
      // Stamped the first time it goes live and left alone after, so the
      // published date does not jump on every edit.
      publishedAt:
        dto.isPublished && !existing?.isPublished ? new Date() : undefined,
    };

    const page = existing
      ? await this.prisma.websitePage.update({ where: { id: existing.id }, data })
      : await this.prisma.websitePage.create({
          data: { schoolId, slug: dto.slug, ...data, publishedAt: dto.isPublished ? new Date() : null },
        });

    this.audit.record({
      action: existing ? AuditAction.UPDATE : AuditAction.CREATE,
      module: 'website',
      entity: 'WebsitePage',
      entityId: page.id,
      description: `${existing ? 'Updated' : 'Created'} the "${page.title}" page${
        page.isPublished ? ' (published)' : ' (draft)'
      }`,
      schoolId,
    });

    return page;
  }

  async deletePage(schoolId: string, id: string) {
    const page = await this.prisma.websitePage.findFirst({
      where: { id, schoolId },
      select: { id: true, slug: true, title: true },
    });
    if (!page) throw new NotFoundError('Page');

    await this.prisma.websitePage.delete({ where: { id } });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'website',
      entity: 'WebsitePage',
      entityId: id,
      description: `Deleted the "${page.title}" page`,
      schoolId,
    });

    return { deleted: true };
  }

  async listAlbums(schoolId: string) {
    return this.prisma.galleryAlbum.findMany({
      where: { schoolId },
      orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }],
      include: { _count: { select: { photos: true } } },
    });
  }

  async upsertAlbum(schoolId: string, dto: UpsertGalleryAlbumDto, albumId?: string) {
    const slug =
      dto.slug ??
      dto.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    const clash = await this.prisma.galleryAlbum.findFirst({
      where: { schoolId, slug, ...(albumId ? { id: { not: albumId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new ConflictError(`An album with the address "${slug}" already exists`);

    const data = {
      title: dto.title,
      slug,
      description: dto.description ?? null,
      coverImageUrl: dto.coverImageUrl ?? null,
      eventDate: dto.eventDate ? parseDateOnly(dto.eventDate) : null,
      isPublished: dto.isPublished ?? false,
    };

    return this.prisma.transaction(async (tx) => {
      const album = albumId
        ? await tx.galleryAlbum.update({ where: { id: albumId }, data })
        : await tx.galleryAlbum.create({ data: { schoolId, ...data } });

      if (dto.photos) {
        // The payload is the album's whole photo list, so replace rather than
        // append — otherwise a removal in the editor would never take effect.
        await tx.galleryPhoto.deleteMany({ where: { albumId: album.id } });
        await tx.galleryPhoto.createMany({
          data: dto.photos.map((photo, index) => ({
            albumId: album.id,
            url: photo.url,
            caption: photo.caption ?? null,
            storageKey: photo.storageKey ?? null,
            sortOrder: index,
          })),
        });
      }

      return tx.galleryAlbum.findUniqueOrThrow({
        where: { id: album.id },
        include: { photos: { orderBy: { sortOrder: 'asc' } } },
      });
    });
  }

  async deleteAlbum(schoolId: string, id: string) {
    const album = await this.prisma.galleryAlbum.findFirst({
      where: { id, schoolId },
      select: { id: true, title: true },
    });
    if (!album) throw new NotFoundError('Album');

    await this.prisma.galleryAlbum.delete({ where: { id } });

    this.audit.record({
      action: AuditAction.DELETE,
      module: 'website',
      entity: 'GalleryAlbum',
      entityId: id,
      description: `Deleted the "${album.title}" album`,
      schoolId,
    });

    return { deleted: true };
  }

  /** Creates any missing core page as an unpublished draft to edit. */
  async seedCorePages(schoolId: string, userId: string) {
    const existing = await this.prisma.websitePage.findMany({
      where: { schoolId },
      select: { slug: true },
    });
    const have = new Set(existing.map((page) => page.slug));
    const missing = CORE_PAGES.filter((page) => !have.has(page.slug));

    if (missing.length === 0) return { created: 0 };

    await this.prisma.websitePage.createMany({
      data: missing.map((page, index) => ({
        schoolId,
        slug: page.slug,
        title: page.title,
        content: [] as unknown as Prisma.InputJsonValue,
        isPublished: false,
        showInMenu: true,
        sortOrder: index,
        updatedById: userId,
      })),
    });

    return { created: missing.length };
  }

  // -------------------------------------------------------------------------

  private async schoolIdBySlug(slug: string): Promise<string> {
    const school = await this.prisma.school.findFirst({
      where: { slug, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!school) throw new NotFoundError('School');
    return school.id;
  }
}
