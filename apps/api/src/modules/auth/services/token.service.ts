import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { AppLogger } from '../../../common/logger/app-logger.service';
import { UnauthorizedError } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import type {
  AuthTokens,
  JwtAccessPayload,
  JwtRefreshPayload,
} from '../../../common/interfaces/authenticated-user.interface';
import { PasswordService } from './password.service';

export interface IssueTokensInput {
  userId: string;
  schoolId: string | null;
  deviceId?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  /** Continues an existing rotation family instead of starting a new one. */
  familyId?: string;
  impersonatedById?: string;
}

/**
 * Issues, rotates and revokes JWT pairs.
 *
 * Refresh tokens are single-use and rotated on every exchange. Each token
 * belongs to a "family"; presenting a refresh token that has already been used
 * is treated as theft and revokes the entire family immediately.
 */
@Injectable()
export class TokenService {
  private readonly log: AppLogger;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    logger: AppLogger,
  ) {
    this.log = logger.child('TokenService');
  }

  async issue(input: IssueTokensInput): Promise<AuthTokens & { sessionId: string }> {
    const sessionId = randomUUID();
    const familyId = input.familyId ?? randomUUID();

    const accessToken = await this.jwt.signAsync(
      {
        sub: input.userId,
        sid: sessionId,
        sch: input.schoolId,
        typ: 'access',
        ...(input.impersonatedById ? { imp: input.impersonatedById } : {}),
      } satisfies JwtAccessPayload,
      {
        secret: this.config.getOrThrow<string>('auth.jwtSecret'),
        expiresIn: this.config.get<string>('auth.jwtExpiresIn', '15m') as SignOptions['expiresIn'],
      },
    );

    const refreshToken = await this.jwt.signAsync(
      { sub: input.userId, sid: sessionId, fam: familyId, typ: 'refresh' } satisfies JwtRefreshPayload,
      {
        secret: this.config.getOrThrow<string>('auth.refreshSecret'),
        expiresIn: this.config.get<string>('auth.refreshExpiresIn', '30d') as SignOptions['expiresIn'],
      },
    );

    const refreshExpiresIn = this.durationToSeconds(
      this.config.get<string>('auth.refreshExpiresIn', '30d'),
    );

    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: input.userId,
        refreshTokenHash: this.passwords.hashToken(refreshToken),
        familyId,
        deviceId: input.deviceId ?? null,
        userAgent: input.userAgent?.slice(0, 500) ?? null,
        ipAddress: input.ipAddress ?? null,
        expiresAt: new Date(Date.now() + refreshExpiresIn * 1000),
      },
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.durationToSeconds(this.config.get<string>('auth.jwtExpiresIn', '15m')),
      refreshExpiresIn,
      sessionId,
    };
  }

  /**
   * Validates a refresh token and returns the session it belongs to.
   * Detects and neutralises replay of an already-rotated token.
   */
  async verifyRefreshToken(token: string): Promise<{
    payload: JwtRefreshPayload;
    session: { id: string; userId: string; familyId: string; deviceId: string | null };
  }> {
    let payload: JwtRefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtRefreshPayload>(token, {
        secret: this.config.getOrThrow<string>('auth.refreshSecret'),
      });
    } catch (error) {
      const expired = (error as Error)?.name === 'TokenExpiredError';
      throw new UnauthorizedError(
        expired ? 'Your session has expired. Please sign in again.' : 'Invalid session token',
        expired ? ErrorCode.TOKEN_EXPIRED : ErrorCode.TOKEN_INVALID,
      );
    }

    if (payload.typ !== 'refresh') {
      throw new UnauthorizedError('Invalid session token', ErrorCode.TOKEN_INVALID);
    }

    const tokenHash = this.passwords.hashToken(token);
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: tokenHash },
      select: {
        id: true,
        userId: true,
        familyId: true,
        deviceId: true,
        revokedAt: true,
        revokedReason: true,
        expiresAt: true,
      },
    });

    if (!session) {
      // The token verified cryptographically but is not the current one for its
      // session: it has already been rotated. Assume theft and kill the family.
      await this.revokeFamily(payload.fam, 'refresh_token_reuse_detected');
      this.log.warn('Refresh token replay detected; token family revoked', {
        userId: payload.sub,
        familyId: payload.fam,
      });
      throw new UnauthorizedError(
        'This session is no longer valid. Please sign in again.',
        ErrorCode.REFRESH_TOKEN_REUSED,
      );
    }

    if (session.revokedAt) {
      // A session revoked because it was *rotated* means the caller presented a
      // token that has already been exchanged — the same signal as a missing
      // row, and equally a sign of theft. Anything else (logout, password
      // change, suspension) is a legitimate revocation, so the two are reported
      // differently even though both kill the family.
      const wasRotated = session.revokedReason === 'rotated';
      await this.revokeFamily(
        session.familyId,
        wasRotated ? 'refresh_token_reuse_detected' : 'revoked_session_reuse',
      );

      if (wasRotated) {
        this.log.warn('Rotated refresh token replayed; token family revoked', {
          userId: session.userId,
          familyId: session.familyId,
        });
        throw new UnauthorizedError(
          'This session is no longer valid. Please sign in again.',
          ErrorCode.REFRESH_TOKEN_REUSED,
        );
      }

      throw new UnauthorizedError('This session has been signed out', ErrorCode.SESSION_REVOKED);
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError(
        'Your session has expired. Please sign in again.',
        ErrorCode.TOKEN_EXPIRED,
      );
    }

    return { payload, session };
  }

  /** Consumes the presented refresh token and issues a fresh pair in its family. */
  async rotate(
    oldSessionId: string,
    input: IssueTokensInput,
  ): Promise<AuthTokens & { sessionId: string }> {
    const tokens = await this.issue(input);

    await this.prisma.session.update({
      where: { id: oldSessionId },
      data: {
        revokedAt: new Date(),
        revokedReason: 'rotated',
        replacedById: tokens.sessionId,
        lastUsedAt: new Date(),
      },
    });

    return tokens;
  }

  async revokeSession(sessionId: string, reason = 'logout'): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeAllForUser(userId: string, reason: string, exceptSessionId?: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }

  async listSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        device: {
          select: { platform: true, deviceName: true, deviceModel: true, appVersion: true },
        },
      },
    });
  }

  /** Removes expired and long-revoked sessions. Invoked by a scheduled job. */
  async pruneExpiredSessions(): Promise<number> {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await this.prisma.session.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }],
      },
    });
    return result.count;
  }

  private durationToSeconds(duration: string): number {
    const match = /^(\d+)([smhd])$/.exec(duration.trim());
    if (!match) {
      const seconds = Number.parseInt(duration, 10);
      return Number.isFinite(seconds) ? seconds : 900;
    }
    const value = Number.parseInt(match[1], 10);
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * (multipliers[match[2]] ?? 1);
  }
}
