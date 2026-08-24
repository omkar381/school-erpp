import { Module } from '@nestjs/common';
import { GuardiansModule } from '../guardians/guardians.module';
import { PdfController } from './pdf.controller';
import { PdfDocumentsService } from './pdf-documents.service';
import { PdfRenderer } from './pdf.renderer';
import { PdfService } from './pdf.service';

@Module({
  imports: [GuardiansModule],
  controllers: [PdfController],
  providers: [PdfRenderer, PdfService, PdfDocumentsService],
  exports: [PdfService, PdfDocumentsService],
})
export class PdfModule {}
