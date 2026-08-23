import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { join } from 'node:path';
import { ServeStaticModule } from '@nestjs/serve-static';

import { configuration } from './config/configuration';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { LoggerModule } from './common/logger/logger.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { ModuleGuard } from './common/guards/module.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { CommonModule } from './common/common.module';

import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { StorageModule } from './modules/storage/storage.module';
import { QueueModule } from './queue/queue.module';
import { SchoolsModule } from './modules/schools/schools.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { AcademicsModule } from './modules/academics/academics.module';
import { StudentsModule } from './modules/students/students.module';
import { GuardiansModule } from './modules/guardians/guardians.module';
import { StaffModule } from './modules/staff/staff.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { TimetableModule } from './modules/timetable/timetable.module';
import { HomeworkModule } from './modules/homework/homework.module';
import { AssignmentsModule } from './modules/assignments/assignments.module';
import { ExamsModule } from './modules/exams/exams.module';
import { FeesModule } from './modules/fees/fees.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { NoticesModule } from './modules/notices/notices.module';
import { ChatModule } from './modules/chat/chat.module';
import { LeaveModule } from './modules/leave/leave.module';
import { EventsModule } from './modules/events/events.module';
import { TransportModule } from './modules/transport/transport.module';
import { LibraryModule } from './modules/library/library.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { AdmissionsModule } from './modules/admissions/admissions.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ReportsModule } from './modules/reports/reports.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { SearchModule } from './modules/search/search.module';
import { PdfModule } from './modules/pdf/pdf.module';
import { CertificatesModule } from './modules/certificates/certificates.module';
import { SupportModule } from './modules/support/support.module';
import { PlatformModule } from './modules/platform/platform.module';
import { WebsiteModule } from './modules/website/website.module';
import { SettingsModule } from './modules/settings/settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
      envFilePath: ['.env.local', '.env'],
      cache: true,
      expandVariables: true,
    }),

    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: Number(process.env.THROTTLE_TTL_SECONDS ?? 60) * 1000,
          limit: Number(process.env.THROTTLE_LIMIT ?? 120),
        },
        {
          name: 'auth',
          ttl: 60_000,
          limit: Number(process.env.AUTH_THROTTLE_LIMIT ?? 10),
        },
      ],
    }),

    EventEmitterModule.forRoot({ maxListeners: 30, verboseMemoryLeak: false }),
    ScheduleModule.forRoot(),

    // Local-disk storage driver serves uploads directly in development.
    ...(process.env.STORAGE_DRIVER === 'local'
      ? [
          ServeStaticModule.forRoot({
            rootPath: join(process.cwd(), process.env.STORAGE_LOCAL_PATH ?? './storage/local'),
            serveRoot: '/static',
            serveStaticOptions: { index: false, maxAge: 3600_000 },
          }),
        ]
      : []),

    LoggerModule,
    CommonModule,
    DatabaseModule,
    QueueModule,
    StorageModule,
    RealtimeModule,
    NotificationsModule,
    AuditModule,
    HealthModule,
    AuthModule,

    // Domain modules
    PlatformModule,
    SchoolsModule,
    SettingsModule,
    UsersModule,
    RolesModule,
    AcademicsModule,
    StudentsModule,
    GuardiansModule,
    StaffModule,
    AttendanceModule,
    TimetableModule,
    HomeworkModule,
    AssignmentsModule,
    ExamsModule,
    FeesModule,
    PaymentsModule,
    NoticesModule,
    ChatModule,
    LeaveModule,
    EventsModule,
    TransportModule,
    LibraryModule,
    InventoryModule,
    AdmissionsModule,
    DocumentsModule,
    CertificatesModule,
    PdfModule,
    ReportsModule,
    DashboardModule,
    SearchModule,
    SupportModule,
    WebsiteModule,
  ],
  providers: [
    // Guard order matters: authenticate, then rate-limit, then resolve the
    // tenant, then check module availability, then check permissions.
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: TenantGuard },
    { provide: APP_GUARD, useExisting: ModuleGuard },
    { provide: APP_GUARD, useExisting: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
