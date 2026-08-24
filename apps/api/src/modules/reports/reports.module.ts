import { Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module';
import { ExportService } from './export.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [PdfModule],
  controllers: [ReportsController],
  providers: [ExportService, ReportsService],
  exports: [ExportService, ReportsService],
})
export class ReportsModule {}
