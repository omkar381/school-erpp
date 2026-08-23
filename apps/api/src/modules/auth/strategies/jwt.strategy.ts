import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { PrismaService } from '../../../database/prisma.service';
import { RequestContext } from '../../../common/context/request-context';
import { UnauthorizedError } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import type {
  AuthenticatedUser,
  JwtAccessPayload,
} from '../../../common/interfaces/authenticated-user.interface';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (request: Request) => request.cookies?.access_token ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('auth.jwtSecret'),
      passReqToCallback: false,
    });
  }

  async validate(payload: JwtAccessPayload): Promise<AuthenticatedUser> {
    if (payload.typ !== 'access') {
      throw new UnauthorizedError('Invalid authentication token', ErrorCode.TOKEN_INVALID);
    }

    // A revoked session must stop working immediately, not at token expiry.
    const session = await this.prisma.session.findFirst({
      where: { id: payload.sid, userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });

    if (!session) {
      throw new UnauthorizedError(
        'This session has ended. Please sign in again.',
        ErrorCode.SESSION_REVOKED,
      );
    }

    const user = await this.auth.buildAuthenticatedUser(payload.sub, payload.sid, payload.imp);

    if (user.status !== 'ACTIVE' && user.status !== 'PENDING_VERIFICATION') {
      throw new UnauthorizedError('This account is not active', ErrorCode.ACCOUNT_INACTIVE);
    }

    RequestContext.set('userId', user.id);
    RequestContext.set('schoolId', user.schoolId ?? undefined);
    RequestContext.set('roles', user.roles);
    RequestContext.set('isSuperAdmin', user.isSuperAdmin);
    if (payload.imp) RequestContext.set('impersonatedById', payload.imp);

    // Session activity is tracked without blocking the request path.
    void this.prisma.session
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return user;
  }
}
