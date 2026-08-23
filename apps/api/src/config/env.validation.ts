import { z } from 'zod';

/**
 * Fail-fast validation of the process environment. The application refuses to
 * boot when a required secret is missing or obviously unsafe, so a
 * misconfigured deployment never reaches the point of serving traffic.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
    JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
    JWT_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

    REDIS_URL: z.string().optional(),
    STORAGE_DRIVER: z.enum(['local', 's3', 'cloudinary']).default('local'),
    SMS_DRIVER: z.enum(['log', 'msg91', 'twilio']).default('log'),
  })
  .passthrough()
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET must differ from JWT_SECRET in production',
      });
    }
    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (env[key].includes('change-me') || env[key].startsWith('dev-only')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} still holds a development placeholder value`,
        });
      }
    }
  });

export type ValidatedEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return { ...config, ...result.data };
}
