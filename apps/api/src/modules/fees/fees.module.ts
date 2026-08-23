import { Module } from '@nestjs/common';
import { AcademicsModule } from '../academics/academics.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { FeesController } from './fees.controller';
import { FeeStructuresService } from './services/fee-structures.service';
import { FinanceDashboardService } from './services/finance-dashboard.service';
import { InvoicesService } from './services/invoices.service';

@Module({
  imports: [AcademicsModule, GuardiansModule],
  controllers: [FeesController],
  providers: [FeeStructuresService, InvoicesService, FinanceDashboardService],
  exports: [FeeStructuresService, InvoicesService, FinanceDashboardService],
})
export class FeesModule {}
