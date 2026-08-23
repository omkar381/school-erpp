import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, Prisma, RoleType, UserStatus, type User } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import type {
  AuthTokens,
  AuthenticatedUser,
} from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { OtpService } from './services/otp.service';
import type {
  ChangePasswordDto,
  DeviceInfoDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
} from './dto/auth.dto';

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

export interface LoginResult {
  user: AuthenticatedUser;
  tokens: AuthTokens;
}

const USER_WITH_ROLES = {
  roles: { select: { role: { select: { id: true, type: true } } } },
  student: { select: { id: true } },
  guardian: { select: { id: true } },
  staff: { select: { id: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class AuthService {
  private readonly log: AppLogger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    logger: AppLogger,
  ) {
    this.log = logger.child('AuthService');
  }

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------

  async login(dto: LoginDto, meta: RequestMeta): Promise<LoginResult> {
    const identifier = dto.identifier.trim().toLowerCase();
    const isEmail = identifier.includes('@');

    const candidates = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(isEmail ? { email: identifier } : { phone: this.normalizePhone(identifier) }),
        ...(dto.schoolId ? { schoolId: dto.schoolId } : {}),
      },
      include: USER_WITH_ROLES,
      take: 5,
    });

    if (candidates.length === 0) {
      // Spend comparable time on a miss so the response cannot be used to
      // enumerate which identifiers exist.
      await this.passwords.verify(null, dto.password);
      await this.recordFailedLogin(null, identifier, meta, 'user_not_found');
      throw new UnauthorizedError('Incorrect email/phone or password', ErrorCode.INVALID_CREDENTIALS);
    }

    if (candidates.length > 1) {
      throw new BadRequestError(
        'This account exists at more than one school. Please choose which school to sign in to.',
        ErrorCode.BAD_REQUEST,
        { schools: candidates.map((c) => c.schoolId) },
      );
    }

    const user = candidates[0];
    this.assertLoginAllowed(user);

    const valid = await this.passwords.verify(user.passwordHash, dto.password);
    if (!valid) {
      await this.registerFailedAttempt(user);
      await this.recordFailedLogin(user.id, identifier, meta, 'bad_password');
      throw new UnauthorizedError('Incorrect email/phone or password', ErrorCode.INVALID_CREDENTIALS);
    }

    // Transparently upgrade hashes produced under older argon2 parameters.
    if (user.passwordHash && this.passwords.needsRehash(user.passwordHash)) {
      const upgraded = await this.passwords.hash(dto.password);
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: upgraded } });
    }

    return this.completeLogin(user, meta, dto.device);
  }

  async loginWithOtp(
    phone: string,
    code: string,
    meta: RequestMeta,
    device?: DeviceInfoDto,
  ): Promise<LoginResult> {
    const normalized = this.normalizePhone(phone);
    await this.otp.verify(normalized, code, 'LOGIN');

    const user = await this.prisma.user.findFirst({
      where: { phone: normalized, deletedAt: null },
      include: USER_WITH_ROLES,
    });

    if (!user) {
      throw new UnauthorizedError('No account is registered with this number', ErrorCode.INVALID_CREDENTIALS);
    }

    this.assertLoginAllowed(user);

    if (!user.phoneVerifiedAt) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { phoneVerifiedAt: new Date() },
      });
    }

    return this.completeLogin(user, meta, device);
  }

  private async completeLogin(
    user: User & { roles: Array<{ role: { id: string; type: RoleType } }> },
    meta: RequestMeta,
    device?: DeviceInfoDto,
  ): Promise<LoginResult> {
    const deviceId = device ? await this.upsertDevice(user.id, device) : null;

    const issued = await this.tokens.issue({
      userId: user.id,
      schoolId: user.schoolId,
      deviceId,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: meta.ipAddress ?? null,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    this.audit.record({
      action: AuditAction.LOGIN,
      module: 'auth',
      entity: 'User',
      entityId: user.id,
      description: 'Signed in',
      schoolId: user.schoolId,
      userId: user.id,
    });

    const principal = await this.buildAuthenticatedUser(user.id, issued.sessionId);

    return {
      user: principal,
      tokens: {
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        tokenType: 'Bearer',
        expiresIn: issued.expiresIn,
        refreshExpiresIn: issued.refreshExpiresIn,
      },
    };
  }

  private assertLoginAllowed(user: User): void {
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new ForbiddenError(
        `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        ErrorCode.ACCOUNT_LOCKED,
      );
    }

    switch (user.status) {
      case UserStatus.SUSPENDED:
        throw new ForbiddenError(
          'This account has been suspended. Please contact your school administrator.',
          ErrorCode.ACCOUNT_SUSPENDED,
        );
      case UserStatus.INACTIVE:
        throw new ForbiddenError(
          'This account is inactive. Please contact your school administrator.',
          ErrorCode.ACCOUNT_INACTIVE,
        );
      case UserStatus.LOCKED:
        throw new ForbiddenError(
          'This account is locked. Please contact your school administrator.',
          ErrorCode.ACCOUNT_LOCKED,
        );
      default:
        break;
    }
  }

  private async registerFailedAttempt(user: User): Promise<void> {
    const max = this.config.get<number>('auth.maxFailedLoginAttempts', 5);
    const lockMinutes = this.config.get<number>('auth.accountLockMinutes', 15);
    const attempts = user.failedLoginAttempts + 1;

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: attempts,
        ...(attempts >= max
          ? { lockedUntil: new Date(Date.now() + lockMinutes * 60_000) }
          : {}),
      },
    });

    if (attempts >= max) {
      this.log.warn('Account locked after repeated failed sign-in attempts', {
        userId: user.id,
        attempts,
      });
    }
  }

  private async recordFailedLogin(
    userId: string | null,
    identifier: string,
    meta: RequestMeta,
    reason: string,
  ): Promise<void> {
    await this.audit.recordAsync({
      action: AuditAction.LOGIN_FAILED,
      module: 'auth',
      entity: 'User',
      entityId: userId,
      description: `Failed sign-in for "${this.maskIdentifier(identifier)}" (${reason})`,
      userId,
      schoolId: null,
    });
  }

  // -------------------------------------------------------------------------
  // Tokens & sessions
  // -------------------------------------------------------------------------

  async refresh(refreshToken: string, meta: RequestMeta): Promise<LoginResult> {
    const { payload, session } = await this.tokens.verifyRefreshToken(refreshToken);

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
      include: USER_WITH_ROLES,
    });

    if (!user) throw new UnauthorizedError('Account no longer exists', ErrorCode.TOKEN_INVALID);
    this.assertLoginAllowed(user);

    const issued = await this.tokens.rotate(session.id, {
      userId: user.id,
      schoolId: user.schoolId,
      deviceId: session.deviceId,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
      familyId: session.familyId,
    });

    const principal = await this.buildAuthenticatedUser(user.id, issued.sessionId);

    return {
      user: principal,
      tokens: {
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        tokenType: 'Bearer',
        expiresIn: issued.expiresIn,
        refreshExpiresIn: issued.refreshExpiresIn,
      },
    };
  }

  async logout(sessionId: string, userId: string, schoolId: string | null): Promise<void> {
    await this.tokens.revokeSession(sessionId, 'logout');
    this.audit.record({
      action: AuditAction.LOGOUT,
      module: 'auth',
      entity: 'User',
      entityId: userId,
      description: 'Signed out',
      userId,
      schoolId,
    });
  }

  async logoutAll(userId: string, currentSessionId?: string): Promise<{ revoked: number }> {
    const revoked = await this.tokens.revokeAllForUser(userId, 'logout_all', currentSessionId);
    return { revoked };
  }

  listSessions(userId: string) {
    return this.tokens.listSessions(userId);
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    });
    if (!session) throw new NotFoundError('Session');
    await this.tokens.revokeSession(sessionId, 'revoked_by_user');
  }

  // -------------------------------------------------------------------------
  // Password lifecycle
  // -------------------------------------------------------------------------

  /**
   * Always resolves successfully, whether or not the identifier matches an
   * account, so this endpoint cannot be used to discover registered users.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const identifier = dto.identifier.trim().toLowerCase();
    const isEmail = identifier.includes('@');

    const user = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        status: { in: [UserStatus.ACTIVE, UserStatus.PENDING_VERIFICATION] },
        ...(isEmail ? { email: identifier } : { phone: this.normalizePhone(identifier) }),
      },
      select: { id: true, email: true, phone: true, firstName: true, schoolId: true },
    });

    if (!user) {
      this.log.debug('Password reset requested for unknown identifier');
      return;
    }

    if (!isEmail) {
      await this.otp.send(this.normalizePhone(identifier), 'RESET_PASSWORD', user.id);
      return;
    }

    const token = this.passwords.generateToken();
    const ttlMinutes = this.config.get<number>('auth.passwordResetTtlMinutes', 30);

    await this.prisma.$transaction([
      // Any earlier unused reset link is invalidated when a new one is issued.
      this.prisma.verificationToken.updateMany({
        where: { userId: user.id, purpose: 'PASSWORD_RESET', consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.verificationToken.create({
        data: {
          userId: user.id,
          purpose: 'PASSWORD_RESET',
          tokenHash: this.passwords.hashToken(token),
          expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
        },
      }),
    ]);

    const resetUrl = `${this.config.get<string>('app.webUrl')}/reset-password?token=${token}`;

    await this.notifications.sendEmail({
      to: user.email!,
      subject: 'Reset your password',
      template: 'password-reset',
      data: { firstName: user.firstName, resetUrl, expiryMinutes: ttlMinutes },
    });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    this.passwords.validate(dto.password);

    const tokenHash = this.passwords.hashToken(dto.token);
    const record = await this.prisma.verificationToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, purpose: true, consumedAt: true, expiresAt: true },
    });

    if (!record || record.purpose !== 'PASSWORD_RESET' || record.consumedAt) {
      throw new BadRequestError('This reset link is invalid or has already been used', ErrorCode.TOKEN_INVALID);
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestError('This reset link has expired. Please request a new one.', ErrorCode.TOKEN_EXPIRED);
    }

    const passwordHash = await this.passwords.hash(dto.password);

    await this.prisma.$transaction([
      this.prisma.verificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      // A password reset invalidates every existing session.
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'password_reset' },
      }),
    ]);

    this.audit.record({
      action: AuditAction.PASSWORD_RESET,
      module: 'auth',
      entity: 'User',
      entityId: record.userId,
      description: 'Password reset via emailed link',
      userId: record.userId,
    });
  }

  async changePassword(
    userId: string,
    sessionId: string,
    dto: ChangePasswordDto,
  ): Promise<{ revokedSessions: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true, schoolId: true },
    });
    if (!user) throw new NotFoundError('User');

    const valid = await this.passwords.verify(user.passwordHash, dto.currentPassword);
    if (!valid) {
      throw new BadRequestError('Your current password is incorrect', ErrorCode.INVALID_CREDENTIALS);
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestError(
        'Your new password must be different from the current one',
        ErrorCode.PASSWORD_REUSED,
      );
    }

    this.passwords.validate(dto.newPassword);
    const passwordHash = await this.passwords.hash(dto.newPassword);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false },
    });

    const revokedSessions =
      dto.revokeOtherSessions === false
        ? 0
        : await this.tokens.revokeAllForUser(userId, 'password_changed', sessionId);

    this.audit.record({
      action: AuditAction.PASSWORD_CHANGE,
      module: 'auth',
      entity: 'User',
      entityId: userId,
      description: 'Password changed',
      userId,
      schoolId: user.schoolId,
    });

    return { revokedSessions };
  }

  // -------------------------------------------------------------------------
  // Email verification
  // -------------------------------------------------------------------------

  async sendVerificationEmail(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, firstName: true, emailVerifiedAt: true },
    });

    if (!user?.email || user.emailVerifiedAt) return;

    const token = this.passwords.generateToken();
    const ttlHours = this.config.get<number>('auth.emailVerifyTtlHours', 48);

    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        purpose: 'EMAIL_VERIFY',
        tokenHash: this.passwords.hashToken(token),
        expiresAt: new Date(Date.now() + ttlHours * 3_600_000),
      },
    });

    await this.notifications.sendEmail({
      to: user.email,
      subject: 'Verify your email address',
      template: 'email-verification',
      data: {
        firstName: user.firstName,
        verifyUrl: `${this.config.get<string>('app.webUrl')}/verify-email?token=${token}`,
        expiryHours: ttlHours,
      },
    });
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: this.passwords.hashToken(token) },
      select: { id: true, userId: true, purpose: true, consumedAt: true, expiresAt: true },
    });

    if (!record || record.purpose !== 'EMAIL_VERIFY' || record.consumedAt) {
      throw new BadRequestError('This verification link is invalid or has already been used', ErrorCode.TOKEN_INVALID);
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestError('This verification link has expired', ErrorCode.TOKEN_EXPIRED);
    }

    await this.prisma.$transaction([
      this.prisma.verificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: {
          emailVerifiedAt: new Date(),
          status: UserStatus.ACTIVE,
        },
      }),
    ]);
  }

  // -------------------------------------------------------------------------
  // Principal assembly
  // -------------------------------------------------------------------------

  /**
   * Rebuilds the request principal from the database on every request.
   * Roles and permissions are deliberately *not* embedded in the access token,
   * so revoking a permission takes effect immediately rather than at token expiry.
   */
  async buildAuthenticatedUser(
    userId: string,
    sessionId: string,
    impersonatedById?: string,
  ): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        schoolId: true,
        email: true,
        phone: true,
        firstName: true,
        middleName: true,
        lastName: true,
        displayName: true,
        avatarUrl: true,
        status: true,
        locale: true,
        timezone: true,
        mustChangePassword: true,
        roles: {
          select: {
            role: {
              select: {
                type: true,
                permissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },
        permissions: { select: { effect: true, permission: { select: { key: true } } } },
        student: { select: { id: true } },
        guardian: { select: { id: true } },
        staff: { select: { id: true } },
      },
    });

    if (!user) throw new UnauthorizedError('Account no longer exists', ErrorCode.TOKEN_INVALID);

    const roles = user.roles.map((entry) => entry.role.type);
    const granted = new Set<string>();

    for (const entry of user.roles) {
      for (const rolePermission of entry.role.permissions) {
        granted.add(rolePermission.permission.key);
      }
    }

    // Per-user overrides are applied last: an explicit deny always wins.
    for (const override of user.permissions) {
      if (override.effect) granted.add(override.permission.key);
      else granted.delete(override.permission.key);
    }

    return {
      id: user.id,
      schoolId: user.schoolId,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName:
        user.displayName ?? [user.firstName, user.lastName].filter(Boolean).join(' ').trim(),
      avatarUrl: user.avatarUrl,
      status: user.status,
      locale: user.locale,
      timezone: user.timezone,
      roles,
      permissions: [...granted],
      isSuperAdmin: roles.includes(RoleType.SUPER_ADMIN),
      mustChangePassword: user.mustChangePassword,
      staffId: user.staff?.id ?? null,
      studentId: user.student?.id ?? null,
      guardianId: user.guardian?.id ?? null,
      sessionId,
      ...(impersonatedById ? { impersonatedById } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Devices
  // -------------------------------------------------------------------------

  async upsertDevice(userId: string, device: DeviceInfoDto): Promise<string> {
    // A push token identifies a physical device and must belong to at most one
    // user, otherwise notifications would follow a shared handset to the wrong
    // account after a sign-out.
    if (device.fcmToken) {
      await this.prisma.device.deleteMany({
        where: { fcmToken: device.fcmToken, userId: { not: userId } },
      });
    }

    const existing = device.fcmToken
      ? await this.prisma.device.findFirst({
          where: { userId, fcmToken: device.fcmToken },
          select: { id: true },
        })
      : null;

    if (existing) {
      await this.prisma.device.update({
        where: { id: existing.id },
        data: {
          platform: device.platform,
          deviceName: device.deviceName,
          deviceModel: device.deviceModel,
          osVersion: device.osVersion,
          appVersion: device.appVersion,
          lastSeenAt: new Date(),
        },
      });
      return existing.id;
    }

    const created = await this.prisma.device.create({
      data: {
        userId,
        platform: device.platform,
        deviceName: device.deviceName,
        deviceModel: device.deviceModel,
        osVersion: device.osVersion,
        appVersion: device.appVersion,
        fcmToken: device.fcmToken,
      },
      select: { id: true },
    });
    return created.id;
  }

  async removeDevice(userId: string, fcmToken: string): Promise<void> {
    await this.prisma.device.deleteMany({ where: { userId, fcmToken } });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private normalizePhone(phone: string): string {
    const digits = phone.replace(/[^\d+]/g, '');
    return digits.startsWith('+') ? digits : `+${digits.replace(/^0+/, '')}`;
  }

  private maskIdentifier(identifier: string): string {
    if (identifier.includes('@')) {
      const [local, domain] = identifier.split('@');
      return `${local.slice(0, 2)}***@${domain}`;
    }
    return `***${identifier.slice(-4)}`;
  }
}
