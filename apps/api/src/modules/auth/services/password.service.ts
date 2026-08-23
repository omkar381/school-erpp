import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ValidationError } from '../../../common/exceptions/app.exception';

/** Passwords that are common enough to be in any credential-stuffing list. */
const BLOCKLIST = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd',
  '12345678',
  '123456789',
  'qwerty123',
  'admin123',
  'welcome1',
  'welcome123',
  'letmein1',
  'iloveyou',
  'school123',
  'student123',
  'teacher123',
  'changeme',
  'abcd1234',
]);

export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSymbol: false,
};

@Injectable()
export class PasswordService {
  private readonly options: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19_456, // 19 MiB — OWASP minimum for argon2id
    timeCost: 2,
    parallelism: 1,
  };

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  /**
   * Verifies a password. Returns false rather than throwing on a malformed
   * stored hash so a corrupted row cannot be distinguished from a wrong password.
   */
  async verify(hash: string | null | undefined, plain: string): Promise<boolean> {
    if (!hash) {
      // Burn comparable time so callers cannot detect "user has no password".
      await argon2.hash(plain, this.options).catch(() => undefined);
      return false;
    }
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /** True when the stored hash was produced with weaker parameters than current policy. */
  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, this.options);
    } catch {
      return true;
    }
  }

  validate(password: string, policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY): void {
    const errors: Array<{ field: string; message: string; rule?: string }> = [];
    const add = (message: string, rule: string) =>
      errors.push({ field: 'password', message, rule });

    if (password.length < policy.minLength) {
      add(`Password must be at least ${policy.minLength} characters`, 'minLength');
    }
    if (password.length > 128) {
      add('Password must not exceed 128 characters', 'maxLength');
    }
    if (policy.requireUppercase && !/[A-Z]/.test(password)) {
      add('Password must contain an uppercase letter', 'uppercase');
    }
    if (policy.requireLowercase && !/[a-z]/.test(password)) {
      add('Password must contain a lowercase letter', 'lowercase');
    }
    if (policy.requireNumber && !/\d/.test(password)) {
      add('Password must contain a number', 'number');
    }
    if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) {
      add('Password must contain a special character', 'symbol');
    }
    if (BLOCKLIST.has(password.toLowerCase())) {
      add('This password is too common. Please choose a different one.', 'blocklist');
    }
    if (/^(.)\1+$/.test(password)) {
      add('Password must not be a single repeated character', 'repetition');
    }

    if (errors.length > 0) {
      throw new ValidationError('Password does not meet the security requirements', errors);
    }
  }

  /** Generates a readable temporary password that still satisfies the policy. */
  generateTemporary(length = 12): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const all = upper + lower + digits;

    const bytes = randomBytes(length);
    const chars = [
      upper[bytes[0] % upper.length],
      lower[bytes[1] % lower.length],
      digits[bytes[2] % digits.length],
    ];
    for (let i = 3; i < length; i += 1) {
      chars.push(all[bytes[i] % all.length]);
    }

    // Shuffle so the guaranteed characters are not always in the same slots.
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const j = randomBytes(1)[0] % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  /** Cryptographically random, URL-safe token for reset and verification links. */
  generateToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  /** Deterministic hash used to store tokens; tokens are never stored in the clear. */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  compareTokenHash(a: string, b: string): boolean {
    const bufferA = Buffer.from(a, 'utf8');
    const bufferB = Buffer.from(b, 'utf8');
    if (bufferA.length !== bufferB.length) return false;
    return timingSafeEqual(bufferA, bufferB);
  }
}
