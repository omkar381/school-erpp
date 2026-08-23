import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantIntegrityService } from './tenant-integrity.service';

@Global()
@Module({
  providers: [PrismaService, TenantIntegrityService],
  exports: [PrismaService],
})
export class DatabaseModule {}
