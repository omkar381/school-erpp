/**
 * Typed application configuration assembled from environment variables.
 * Every value read from `process.env` in the codebase should flow through here
 * so that defaults and coercion live in exactly one place.
 */

const bool = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const list = (value: string | undefined, fallback: string[] = []): string[] =>
  value
    ? value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : fallback;

export interface AppConfig {
  env: string;
  isProduction: boolean;
  isTest: boolean;
  port: number;
  apiPrefix: string;
  appName: string;
  appUrl: string;
  webUrl: string;
  defaultTimezone: string;
  defaultCurrency: string;
  defaultLocale: string;
  corsOrigins: string[];
}

export const configuration = () => ({
  app: {
    env: process.env.NODE_ENV ?? 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isTest: process.env.NODE_ENV === 'test',
    port: int(process.env.PORT, 4000),
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
    appName: process.env.APP_NAME ?? 'School ERP Platform',
    appUrl: process.env.APP_URL ?? 'http://localhost:4000',
    webUrl: process.env.WEB_URL ?? 'http://localhost:3000',
    defaultTimezone: process.env.DEFAULT_TIMEZONE ?? 'Asia/Kolkata',
    defaultCurrency: process.env.DEFAULT_CURRENCY ?? 'INR',
    defaultLocale: process.env.DEFAULT_LOCALE ?? 'en',
    corsOrigins: list(process.env.CORS_ORIGINS, ['http://localhost:3000']),
  },
  database: {
    url: process.env.DATABASE_URL ?? '',
    logQueries: bool(process.env.DATABASE_LOG_QUERIES),
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    prefix: process.env.REDIS_PREFIX ?? 'erp',
    cacheTtlSeconds: int(process.env.CACHE_TTL_SECONDS, 60),
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET ?? '',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
    passwordResetTtlMinutes: int(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES, 30),
    emailVerifyTtlHours: int(process.env.EMAIL_VERIFY_TOKEN_TTL_HOURS, 48),
    otpTtlSeconds: int(process.env.OTP_TTL_SECONDS, 300),
    otpLength: int(process.env.OTP_LENGTH, 6),
    otpMaxAttempts: int(process.env.OTP_MAX_ATTEMPTS, 5),
    maxFailedLoginAttempts: int(process.env.MAX_FAILED_LOGIN_ATTEMPTS, 5),
    accountLockMinutes: int(process.env.ACCOUNT_LOCK_MINUTES, 15),
    cookieSecret: process.env.COOKIE_SECRET ?? '',
    cookieDomain: process.env.COOKIE_DOMAIN ?? 'localhost',
    cookieSecure: bool(process.env.COOKIE_SECURE),
  },
  throttle: {
    ttlSeconds: int(process.env.THROTTLE_TTL_SECONDS, 60),
    limit: int(process.env.THROTTLE_LIMIT, 120),
    authLimit: int(process.env.AUTH_THROTTLE_LIMIT, 10),
  },
  storage: {
    driver: (process.env.STORAGE_DRIVER ?? 'local') as 'local' | 's3' | 'cloudinary',
    localPath: process.env.STORAGE_LOCAL_PATH ?? './storage/local',
    publicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL ?? 'http://localhost:4000/static',
    maxUploadSizeMb: int(process.env.MAX_UPLOAD_SIZE_MB, 15),
    signedUrlTtlSeconds: int(process.env.SIGNED_URL_TTL_SECONDS, 900),
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? '',
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? 'school-erp',
      accessKey: process.env.S3_ACCESS_KEY ?? '',
      secretKey: process.env.S3_SECRET_KEY ?? '',
      forcePathStyle: bool(process.env.S3_FORCE_PATH_STYLE, true),
    },
    cloudinary: {
      url: process.env.CLOUDINARY_URL ?? '',
      folder: process.env.CLOUDINARY_FOLDER ?? 'school-erp',
    },
  },
  mail: {
    enabled: bool(process.env.MAIL_ENABLED, true),
    host: process.env.SMTP_HOST ?? 'localhost',
    port: int(process.env.SMTP_PORT, 1025),
    secure: bool(process.env.SMTP_SECURE),
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    fromName: process.env.MAIL_FROM_NAME ?? 'School ERP',
    fromAddress: process.env.MAIL_FROM_ADDRESS ?? 'no-reply@schoolerp.local',
  },
  sms: {
    driver: (process.env.SMS_DRIVER ?? 'log') as 'log' | 'msg91' | 'twilio',
    senderId: process.env.SMS_SENDER_ID ?? 'SCHOOL',
    msg91: {
      authKey: process.env.MSG91_AUTH_KEY ?? '',
      templateId: process.env.MSG91_TEMPLATE_ID ?? '',
    },
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
      authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
      from: process.env.TWILIO_FROM ?? '',
    },
  },
  push: {
    enabled: bool(process.env.FCM_ENABLED),
    projectId: process.env.FIREBASE_PROJECT_ID ?? '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
    privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  },
  payments: {
    enabled: bool(process.env.PAYMENTS_ENABLED, true),
    razorpay: {
      keyId: process.env.RAZORPAY_KEY_ID ?? '',
      keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
    },
  },
  queue: {
    enabled: bool(process.env.QUEUE_ENABLED, true),
    concurrency: int(process.env.QUEUE_CONCURRENCY, 5),
  },
  logging: {
    level: process.env.LOG_LEVEL ?? 'info',
    pretty: bool(process.env.LOG_PRETTY, process.env.NODE_ENV !== 'production'),
  },
  swagger: {
    enabled: bool(process.env.SWAGGER_ENABLED, true),
    path: process.env.SWAGGER_PATH ?? 'docs',
  },
});

export type Configuration = ReturnType<typeof configuration>;
