import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { AppLogger } from '../../../common/logger/app-logger.service';
import { BadRequestError, TooManyRequestsError } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { SmsService } from '../../notifications/channels/sms.service';
import { PasswordService } from './password.service';

export type OtpPurpose = 'LOGIN' | 'VERIFY_PHONE' | 'RESET_PASSWORD';

/** Minimum gap between two OTP requests for the same identifier. */
const RESEND_COOLDOWN_MS = 45_000;

@Injectable()
export class OtpService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly passwords: PasswordService,
    private readonly config: ConfigService,
    logger: AppLogger,
  ) {
    this.log = logger.child('OtpService');
  }

  async send(
    identifier: string,
    purpose: OtpPurpose,
    userId?: string,
  ): Promise<{ expiresInSeconds: number; resendAfterSeconds: number }> {
    const recent = await this.prisma.otpCode.findFirst({
      where: { identifier, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    if (recent) {
      const elapsed = Date.now() - recent.createdAt.getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        throw new TooManyRequestsError(
          `Please wait ${Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000)} seconds before requesting another code`,
        );
      }
    }

    const length = this.config.get<number>('auth.otpLength', 6);
    const ttlSeconds = this.config.get<number>('auth.otpTtlSeconds', 300);
    const maxAttempts = this.config.get<number>('auth.otpMaxAttempts', 5);

    const code = this.generateCode(length);

    await this.prisma.$transaction([
      // Only the newest code for an identifier is ever valid.
      this.prisma.otpCode.updateMany({
        where: { identifier, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.otpCode.create({
        data: {
          userId: userId ?? null,
          identifier,
          purpose,
          codeHash: this.passwords.hashToken(code),
          maxAttempts,
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        },
      }),
    ]);

    await this.sms.send({
      to: identifier,
      message: this.buildMessage(code, purpose, ttlSeconds),
      purpose: `OTP_${purpose}`,
    });

    return { expiresInSeconds: ttlSeconds, resendAfterSeconds: RESEND_COOLDOWN_MS / 1000 };
  }

  /**
   * Consumes an OTP. A wrong code counts against the attempt budget; once the
   * budget is exhausted the code is burned so it cannot be brute-forced.
   */
  async verify(identifier: string, code: string, purpose: OtpPurpose): Promise<{ userId: string | null }> {
    const record = await this.prisma.otpCode.findFirst({
      where: { identifier, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        codeHash: true,
        attempts: true,
        maxAttempts: true,
        expiresAt: true,
      },
    });

    if (!record) {
      throw new BadRequestError('No verification code was requested for this number', ErrorCode.OTP_INVALID);
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      await this.prisma.otpCode.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      throw new BadRequestError('This code has expired. Please request a new one.', ErrorCode.OTP_EXPIRED);
    }

    if (record.attempts >= record.maxAttempts) {
      await this.prisma.otpCode.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      throw new BadRequestError(
        'Too many incorrect attempts. Please request a new code.',
        ErrorCode.OTP_ATTEMPTS_EXCEEDED,
      );
    }

    const matches = this.passwords.compareTokenHash(
      record.codeHash,
      this.passwords.hashToken(code.trim()),
    );

    if (!matches) {
      const attempts = record.attempts + 1;
      await this.prisma.otpCode.update({
        where: { id: record.id },
        data: {
          attempts,
          ...(attempts >= record.maxAttempts ? { consumedAt: new Date() } : {}),
        },
      });

      const remaining = record.maxAttempts - attempts;
      throw new BadRequestError(
        remaining > 0
          ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : 'Too many incorrect attempts. Please request a new code.',
        remaining > 0 ? ErrorCode.OTP_INVALID : ErrorCode.OTP_ATTEMPTS_EXCEEDED,
      );
    }

    await this.prisma.otpCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    return { userId: record.userId };
  }

  async pruneExpired(): Promise<number> {
    const result = await this.prisma.otpCode.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 24 * 3_600_000) } },
    });
    return result.count;
  }

  private generateCode(length: number): string {
    let code = '';
    for (let i = 0; i < length; i += 1) code += randomInt(0, 10).toString();
    return code;
  }

  private buildMessage(code: string, purpose: OtpPurpose, ttlSeconds: number): string {
    const minutes = Math.round(ttlSeconds / 60);
    const action =
      purpose === 'LOGIN'
        ? 'sign in'
        : purpose === 'RESET_PASSWORD'
          ? 'reset your password'
          : 'verify your number';
    return `${code} is your verification code to ${action}. It expires in ${minutes} minutes. Do not share this code with anyone.`;
  }
}
