import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators';
import { ErrorCode } from '../exceptions/error-codes';
import { UnauthorizedError } from '../exceptions/app.exception';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * Applied globally. Every route requires a valid access token unless it is
 * explicitly marked with `@Public()`.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser = AuthenticatedUser>(
    err: unknown,
    user: TUser,
    info: { name?: string; message?: string } | undefined,
  ): TUser {
    if (err || !user) {
      if (info?.name === 'TokenExpiredError') {
        throw new UnauthorizedError('Your session has expired. Please sign in again.', ErrorCode.TOKEN_EXPIRED);
      }
      if (info?.name === 'JsonWebTokenError') {
        throw new UnauthorizedError('Invalid authentication token', ErrorCode.TOKEN_INVALID);
      }
      if (err instanceof Error) throw err;
      throw new UnauthorizedError();
    }
    return user;
  }
}
