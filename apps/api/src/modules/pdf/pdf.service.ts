import { Injectable } from '@nestjs/common';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { StorageService } from '../storage/storage.service';
import { PdfRenderer } from './pdf.renderer';
import { type SchoolBrand } from './templates/branding';

export interface RenderedPdf {
  buffer: Buffer;
  fileName: string;
  /** Set when the document was persisted; null for one-off downloads. */
  storageKey: string | null;
  sizeBytes: number;
}

interface StoreOptions {
  /** Logical folder under which the object is stored. */
  folder: string;
  fileName: string;
  /** Skip persistence and stream the bytes back only. */
  ephemeral?: boolean;
}

/** How long a brand snapshot is reused before it is re-read. */
const BRAND_TTL_MS = 5 * 60_000;

/** Remote logos are only inlined below this size; anything larger is skipped. */
const MAX_LOGO_BYTES = 512 * 1024;

@Injectable()
export class PdfService {
  private readonly log: AppLogger;
  private readonly brandCache = new Map<string, { brand: SchoolBrand; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly renderer: PdfRenderer,
    logger: AppLogger,
  ) {
    this.log = logger.child('PdfService');
  }

  /**
   * Loads the school's identity and branding for a template.
   *
   * Cached briefly: a batch of five hundred report cards should not re-read
   * the same school row and re-encode the same logo five hundred times.
   */
  async brandFor(schoolId: string): Promise<SchoolBrand> {
    const cached = this.brandCache.get(schoolId);
    if (cached && cached.expiresAt > Date.now()) return cached.brand;

    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: {
        name: true,
        code: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        phone: true,
        email: true,
        website: true,
        board: true,
        affiliationNumber: true,
        currency: true,
        timezone: true,
        primaryColor: true,
        secondaryColor: true,
        logoUrl: true,
      },
    });

    const brand: SchoolBrand = {
      ...school,
      logoDataUri: await this.toDataUri(school.logoUrl),
    };

    this.brandCache.set(schoolId, { brand, expiresAt: Date.now() + BRAND_TTL_MS });
    return brand;
  }

  /** Drops a school's cached branding after a settings or logo change. */
  invalidateBrand(schoolId: string): void {
    this.brandCache.delete(schoolId);
  }

  /**
   * Renders a document definition and, unless it is ephemeral, stores it.
   *
   * Generated PDFs are always private: a fee receipt or a report card is
   * personal data, so it is reached through a signed URL, never a public one.
   */
  async render(
    definition: TDocumentDefinitions,
    schoolId: string | null,
    options: StoreOptions,
  ): Promise<RenderedPdf> {
    const started = Date.now();
    const buffer = await this.renderer.render(definition);
    const fileName = options.fileName.endsWith('.pdf')
      ? options.fileName
      : `${options.fileName}.pdf`;

    let storageKey: string | null = null;

    if (!options.ephemeral) {
      const stored = await this.storage.upload({
        buffer,
        originalName: fileName,
        mimeType: 'application/pdf',
        folder: options.folder,
        schoolId,
        isPublic: false,
      });
      storageKey = stored.storageKey;
    }

    this.log.debug('PDF rendered', {
      schoolId,
      fileName,
      sizeBytes: buffer.length,
      durationMs: Date.now() - started,
      stored: storageKey !== null,
    });

    return { buffer, fileName, storageKey, sizeBytes: buffer.length };
  }

  /** A time-limited link to a stored PDF. */
  signedUrl(storageKey: string, ttlSeconds?: number, downloadName?: string): Promise<string> {
    return this.storage.getSignedUrl(storageKey, ttlSeconds, downloadName);
  }

  /**
   * Reads a previously stored PDF back.
   *
   * Returns null when the object has gone — storage may have been cleared or
   * the bucket rotated — so the caller can simply render it again instead of
   * failing a download the user is entitled to.
   */
  async fetchStored(storageKey: string): Promise<Buffer | null> {
    try {
      return await this.storage.download(storageKey);
    } catch (error) {
      this.log.warn('Stored PDF could not be read; it will be re-rendered', {
        storageKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Fetches an image and returns it as a data URI for embedding.
   *
   * pdfmake cannot fetch anything itself, and templates must never make
   * network calls, so every image is resolved here. A failure is not fatal:
   * a receipt without the logo still beats no receipt.
   */
  async toDataUri(url: string | null | undefined): Promise<string | null> {
    if (!url) return null;

    try {
      // A key from our own storage is read directly rather than over HTTP.
      if (!/^https?:\/\//i.test(url)) {
        const buffer = await this.storage.download(url);
        return this.encode(buffer, this.guessMime(url));
      }

      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return null;

      const contentType = response.headers.get('content-type') ?? 'image/png';
      if (!contentType.startsWith('image/')) return null;

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_LOGO_BYTES) {
        this.log.warn('Image too large to embed in a PDF', { url, bytes: buffer.length });
        return null;
      }

      return this.encode(buffer, contentType);
    } catch (error) {
      this.log.warn('Could not embed image in PDF', {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private encode(buffer: Buffer, mimeType: string): string | null {
    // pdfmake only decodes PNG and JPEG; anything else would throw at render.
    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(mimeType)) return null;
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  private guessMime(key: string): string {
    if (/\.png$/i.test(key)) return 'image/png';
    if (/\.jpe?g$/i.test(key)) return 'image/jpeg';
    return 'application/octet-stream';
  }
}
