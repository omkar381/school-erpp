import type { RoleType, UserStatus } from '@prisma/client';

/**
 * The principal attached to `request.user` after JwtAuthGuard runs.
 * Assembled by AuthService from the database, never taken from the token body
 * beyond the user id — so a revoked role takes effect on the next request.
 */
export interface AuthenticatedUser {
  id: string;
  schoolId: string | null;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string | null;
  displayName: string;
  avatarUrl: string | null;
  status: UserStatus;
  locale: string;
  timezone: string | null;
  roles: RoleType[];
  permissions: string[];
  isSuperAdmin: boolean;
  mustChangePassword: boolean;

  /** Linked domain records, present depending on the user's roles. */
  staffId: string | null;
  studentId: string | null;
  guardianId: string | null;

  sessionId: string;
  /** Set when a super admin is acting as this user. */
  impersonatedById?: string;
}

export interface JwtAccessPayload {
  /** Subject: the user id. */
  sub: string;
  sid: string;
  sch: string | null;
  typ: 'access';
  imp?: string;
  iat?: number;
  exp?: number;
}

export interface JwtRefreshPayload {
  sub: string;
  sid: string;
  /** Token family, used to detect refresh-token replay. */
  fam: string;
  typ: 'refresh';
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshExpiresIn: number;
}
