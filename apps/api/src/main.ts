import 'reflect-metadata';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AppLogger } from './common/logger/app-logger.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { ValidationError } from './common/exceptions/app.exception';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  const config = app.get(ConfigService);
  const logger = app.get(AppLogger);
  app.useLogger(logger);

  const port = config.get<number>('app.port', 4000);
  const apiPrefix = config.get<string>('app.apiPrefix', 'api/v1');
  const isProduction = config.get<string>('app.env') === 'production';
  const maxUploadMb = config.get<number>('storage.maxUploadSizeMb', 15);

  // --- Security headers ---
  app.use(
    helmet({
      contentSecurityPolicy: isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'https:'],
              connectSrc: ["'self'", 'https:', 'wss:'],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
      hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  app.use(compression());
  app.use(cookieParser(config.get<string>('auth.cookieSecret')));

  // Razorpay webhooks are signature-verified against the exact bytes received,
  // so the raw body must survive JSON parsing.
  app.use(
    json({
      limit: `${maxUploadMb}mb`,
      verify: (req, _res, buf) => {
        if ((req as { originalUrl?: string }).originalUrl?.includes('/webhooks/')) {
          (req as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
        }
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: `${maxUploadMb}mb` }));

  // --- CORS ---
  const allowedOrigins = config.get<string[]>('app.corsOrigins', []);
  app.enableCors({
    origin: (origin, callback) => {
      // Requests with no Origin header (mobile apps, curl, server-to-server) are allowed.
      if (!origin) return callback(null, true);
      if (!isProduction || allowedOrigins.includes(origin)) return callback(null, true);
      logger.warn('Blocked cross-origin request', { origin });
      return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-School-Id',
      'X-Request-Id',
      'X-Idempotency-Key',
      'Accept-Language',
    ],
    exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
    maxAge: 86_400,
  });

  app.setGlobalPrefix(apiPrefix, {
    exclude: ['health', 'health/live', 'health/ready', 'metrics'],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: false as never });

  // --- Global pipes, filters, interceptors ---
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validateCustomDecorators: true,
      stopAtFirstError: false,
      exceptionFactory: (errors) => {
        const flatten = (
          items: typeof errors,
          parentPath = '',
        ): Array<{ field: string; message: string; rule?: string }> =>
          items.flatMap((error) => {
            const path = parentPath ? `${parentPath}.${error.property}` : error.property;
            const own = Object.entries(error.constraints ?? {}).map(([rule, message]) => ({
              field: path,
              message,
              rule,
            }));
            const nested = error.children?.length ? flatten(error.children, path) : [];
            return [...own, ...nested];
          });

        return new ValidationError('Please correct the highlighted fields', flatten(errors));
      },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter(logger, config));
  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.enableShutdownHooks();

  // --- Swagger ---
  if (config.get<boolean>('swagger.enabled')) {
    const swaggerPath = config.get<string>('swagger.path', 'docs');

    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('School ERP Platform API')
        .setDescription(
          'Multi-tenant school management REST API.\n\n' +
            '**Authentication** — send `Authorization: Bearer <accessToken>`.\n\n' +
            '**Tenancy** — school users are pinned to their own school. Super administrators ' +
            'may target a school with the `X-School-Id` header.\n\n' +
            '**Responses** — every endpoint returns `{ success, data, message }` on success and ' +
            '`{ success, message, code, errors }` on failure.',
        )
        .setVersion('1.0.0')
        .addBearerAuth(
          { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
          'bearer',
        )
        .addGlobalParameters({
          name: 'X-School-Id',
          in: 'header',
          required: false,
          schema: { type: 'string', format: 'uuid' },
          description: 'Target school (super administrators only)',
        })
        .addServer(`/${apiPrefix}`, 'Current server')
        .build(),
      { operationIdFactory: (controllerKey, methodKey) => `${controllerKey}_${methodKey}` },
    );

    SwaggerModule.setup(swaggerPath, app, document, {
      swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha', docExpansion: 'none' },
      customSiteTitle: 'School ERP API Reference',
    });

    logger.info(`API reference available at /${swaggerPath}`);
  }

  await app.listen(port, '0.0.0.0');

  logger.info('API started', {
    url: `http://localhost:${port}/${apiPrefix}`,
    env: config.get<string>('app.env'),
    nodeVersion: process.version,
  });
}

bootstrap().catch((error) => {
  // The logger may not exist yet if bootstrap failed early.
  // eslint-disable-next-line no-console
  console.error('Failed to start the API:', error);
  process.exit(1);
});
