import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v2 as cloudinary } from 'cloudinary';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { AppLogger } from '../../common/logger/app-logger.service';
import { BadRequestError } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';

export interface UploadInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  /** Logical folder, e.g. `students/<id>/documents`. */
  folder: string;
  schoolId?: string | null;
  isPublic?: boolean;
}

export interface StoredFile {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  /** Only populated for public objects; private ones need a signed URL. */
  url: string | null;
}

/** MIME types accepted by the platform, mapped to their permitted extensions. */
const ALLOWED_TYPES: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'application/pdf': ['.pdf'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'text/csv': ['.csv'],
  'text/plain': ['.txt'],
};

/** Leading bytes used to confirm the declared MIME type matches the content. */
const MAGIC_NUMBERS: Array<{ mime: string; bytes: number[]; offset?: number }> = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
];

@Injectable()
export class StorageService implements OnModuleInit {
  private s3: S3Client | null = null;
  private readonly driver: 'local' | 's3' | 'cloudinary';
  private readonly log: AppLogger;

  constructor(
    private readonly config: ConfigService,
    logger: AppLogger,
  ) {
    this.log = logger.child('StorageService');
    this.driver = config.get<'local' | 's3' | 'cloudinary'>('storage.driver', 'local');
  }

  onModuleInit(): void {
    if (this.driver === 's3') {
      const endpoint = this.config.get<string>('storage.s3.endpoint');
      this.s3 = new S3Client({
        region: this.config.get<string>('storage.s3.region', 'us-east-1'),
        ...(endpoint ? { endpoint } : {}),
        forcePathStyle: this.config.get<boolean>('storage.s3.forcePathStyle', true),
        credentials: {
          accessKeyId: this.config.getOrThrow<string>('storage.s3.accessKey'),
          secretAccessKey: this.config.getOrThrow<string>('storage.s3.secretKey'),
        },
      });
      this.log.info('S3-compatible storage configured', {
        bucket: this.config.get<string>('storage.s3.bucket'),
      });
    } else if (this.driver === 'cloudinary') {
      const url = this.config.get<string>('storage.cloudinary.url');
      if (url) {
        cloudinary.config({ secure: true });
        this.log.info('Cloudinary storage configured');
      } else {
        this.log.error('Cloudinary driver selected but CLOUDINARY_URL is not set');
      }
    } else {
      this.log.info('Local disk storage configured', {
        path: this.config.get<string>('storage.localPath'),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  validate(buffer: Buffer, originalName: string, mimeType: string, maxSizeMb?: number): void {
    const limitMb = maxSizeMb ?? this.config.get<number>('storage.maxUploadSizeMb', 15);
    const limitBytes = limitMb * 1_048_576;

    if (buffer.length === 0) {
      throw new BadRequestError('The uploaded file is empty', ErrorCode.UPLOAD_FAILED);
    }
    if (buffer.length > limitBytes) {
      throw new BadRequestError(
        `File is too large. The maximum size is ${limitMb} MB.`,
        ErrorCode.FILE_TOO_LARGE,
      );
    }

    const allowedExtensions = ALLOWED_TYPES[mimeType];
    if (!allowedExtensions) {
      throw new BadRequestError(
        `Files of type "${mimeType}" are not accepted`,
        ErrorCode.UNSUPPORTED_FILE_TYPE,
      );
    }

    const extension = extname(originalName).toLowerCase();
    if (!allowedExtensions.includes(extension)) {
      throw new BadRequestError(
        `The file extension "${extension}" does not match its content type`,
        ErrorCode.UNSUPPORTED_FILE_TYPE,
      );
    }

    // A declared MIME type is attacker-controlled; confirm it against the bytes.
    const signature = MAGIC_NUMBERS.find((entry) => entry.mime === mimeType);
    if (signature) {
      const offset = signature.offset ?? 0;
      const matches = signature.bytes.every((byte, index) => buffer[offset + index] === byte);
      if (!matches) {
        throw new BadRequestError(
          'The file content does not match its declared type',
          ErrorCode.UNSUPPORTED_FILE_TYPE,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Upload / download / delete
  // ---------------------------------------------------------------------------

  async upload(input: UploadInput): Promise<StoredFile> {
    this.validate(input.buffer, input.originalName, input.mimeType);

    const safeName = this.sanitizeFileName(input.originalName);
    const storageKey = this.buildKey(input.folder, safeName, input.schoolId);
    const checksum = createHash('sha256').update(input.buffer).digest('hex');

    switch (this.driver) {
      case 's3':
        await this.putToS3(storageKey, input.buffer, input.mimeType, input.isPublic);
        break;
      case 'cloudinary':
        await this.putToCloudinary(storageKey, input.buffer, input.mimeType);
        break;
      default:
        await this.putToDisk(storageKey, input.buffer);
        break;
    }

    return {
      storageKey,
      fileName: safeName,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.length,
      checksum,
      url: input.isPublic ? this.publicUrl(storageKey) : null,
    };
  }

  async download(storageKey: string): Promise<Buffer> {
    switch (this.driver) {
      case 's3': {
        const response = await this.s3!.send(
          new GetObjectCommand({
            Bucket: this.config.getOrThrow<string>('storage.s3.bucket'),
            Key: storageKey,
          }),
        );
        return Buffer.from(await response.Body!.transformToByteArray());
      }
      case 'cloudinary': {
        const url = cloudinary.url(storageKey, { secure: true });
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Cloudinary returned ${response.status}`);
        return Buffer.from(await response.arrayBuffer());
      }
      default:
        return readFile(this.resolveLocalPath(storageKey));
    }
  }

  async delete(storageKey: string): Promise<void> {
    try {
      switch (this.driver) {
        case 's3':
          await this.s3!.send(
            new DeleteObjectCommand({
              Bucket: this.config.getOrThrow<string>('storage.s3.bucket'),
              Key: storageKey,
            }),
          );
          break;
        case 'cloudinary':
          await cloudinary.uploader.destroy(storageKey, { resource_type: 'auto' });
          break;
        default:
          await unlink(this.resolveLocalPath(storageKey));
          break;
      }
    } catch (error) {
      // A missing object is not an error for a delete operation.
      this.log.warn('Could not delete stored object', {
        storageKey,
        error: (error as Error).message,
      });
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      if (this.driver === 's3') {
        await this.s3!.send(
          new HeadObjectCommand({
            Bucket: this.config.getOrThrow<string>('storage.s3.bucket'),
            Key: storageKey,
          }),
        );
        return true;
      }
      await readFile(this.resolveLocalPath(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Time-limited URL for a private object. Never hand a raw bucket path to a
   * client — every private download goes through one of these.
   */
  async getSignedUrl(storageKey: string, ttlSeconds?: number, downloadName?: string): Promise<string> {
    const ttl = ttlSeconds ?? this.config.get<number>('storage.signedUrlTtlSeconds', 900);

    switch (this.driver) {
      case 's3':
        return getSignedUrl(
          this.s3!,
          new GetObjectCommand({
            Bucket: this.config.getOrThrow<string>('storage.s3.bucket'),
            Key: storageKey,
            ...(downloadName
              ? { ResponseContentDisposition: `attachment; filename="${downloadName}"` }
              : {}),
          }),
          { expiresIn: ttl },
        );
      case 'cloudinary':
        return cloudinary.utils.private_download_url(storageKey, extname(storageKey).slice(1), {
          expires_at: Math.floor(Date.now() / 1000) + ttl,
        });
      default:
        // The local driver serves files through the API's own authenticated
        // download route rather than a static path.
        return `${this.config.get<string>('app.appUrl')}/${this.config.get<string>('app.apiPrefix')}/documents/download?key=${encodeURIComponent(storageKey)}`;
    }
  }

  publicUrl(storageKey: string): string {
    switch (this.driver) {
      case 's3': {
        const endpoint = this.config.get<string>('storage.s3.endpoint');
        const bucket = this.config.get<string>('storage.s3.bucket');
        return endpoint
          ? `${endpoint.replace(/\/$/, '')}/${bucket}/${storageKey}`
          : `https://${bucket}.s3.${this.config.get<string>('storage.s3.region')}.amazonaws.com/${storageKey}`;
      }
      case 'cloudinary':
        return cloudinary.url(storageKey, { secure: true });
      default:
        return `${this.config.get<string>('storage.publicBaseUrl')}/${storageKey}`;
    }
  }

  // ---------------------------------------------------------------------------
  // Driver implementations
  // ---------------------------------------------------------------------------

  private async putToS3(
    key: string,
    buffer: Buffer,
    mimeType: string,
    isPublic?: boolean,
  ): Promise<void> {
    await this.s3!.send(
      new PutObjectCommand({
        Bucket: this.config.getOrThrow<string>('storage.s3.bucket'),
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ...(isPublic ? { ACL: 'public-read' as const } : {}),
        CacheControl: isPublic ? 'public, max-age=31536000' : 'private, no-cache',
      }),
    );
  }

  private async putToCloudinary(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            public_id: key,
            folder: this.config.get<string>('storage.cloudinary.folder'),
            resource_type: mimeType.startsWith('image/') ? 'image' : 'raw',
          },
          (error) => (error ? reject(error) : resolvePromise()),
        )
        .end(buffer);
    });
  }

  private async putToDisk(key: string, buffer: Buffer): Promise<void> {
    const path = this.resolveLocalPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buffer);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildKey(folder: string, fileName: string, schoolId?: string | null): string {
    const now = new Date();
    const segments = [
      schoolId ?? 'platform',
      folder.replace(/^\/+|\/+$/g, ''),
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${randomUUID()}${extname(fileName).toLowerCase()}`,
    ];
    return segments.filter(Boolean).join('/');
  }

  private sanitizeFileName(name: string): string {
    return (
      name
        .replace(/[^\w.\- ]+/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 180) || 'file'
    );
  }

  /**
   * Resolves a storage key to a path inside the storage root, refusing any key
   * that would escape it via `..` or an absolute path.
   */
  private resolveLocalPath(storageKey: string): string {
    const root = resolve(process.cwd(), this.config.get<string>('storage.localPath', './storage/local'));
    const target = resolve(root, normalize(storageKey).replace(/^(\.\.[/\\])+/, ''));

    if (target !== root && !target.startsWith(root + sep)) {
      throw new BadRequestError('Invalid file path', ErrorCode.BAD_REQUEST);
    }
    return join(target);
  }
}
