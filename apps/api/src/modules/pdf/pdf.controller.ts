import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import {
  ApiSchoolHeader,
  CurrentSchool,
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { SkipEnvelope } from '../../common/interceptors/response.interceptor';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { GuardiansService } from '../guardians/guardians.service';
import { PdfDocumentsService } from './pdf-documents.service';
import type { RenderedPdf } from './pdf.service';

export class IdCardBatchDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  cardIds!: string[];
}

/**
 * Streams generated documents.
 *
 * Every route here returns `application/pdf` rather than the JSON envelope, so
 * the browser can open or save the file directly.
 */
@ApiTags('Documents')
@ApiBearerAuth()
@ApiSchoolHeader()
@ApiProduces('application/pdf')
@Controller('documents')
export class PdfController {
  constructor(
    private readonly documents: PdfDocumentsService,
    private readonly guardians: GuardiansService,
  ) {}

  @Get('invoices/:id')
  @RequireAnyPermission(PERMISSIONS.FEES_VIEW, PERMISSIONS.SELF_FEES_VIEW)
  @SkipEnvelope()
  @ApiOperation({ summary: 'Download a fee invoice' })
  async invoice(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
    @Query('refresh') refresh?: string,
  ) {
    const school = this.school(schoolId);
    await this.assertInvoiceAccess(school, id, user);
    this.send(response, await this.documents.invoice(school, id, refresh === 'true'));
  }

  @Get('receipts/:id')
  @RequireAnyPermission(PERMISSIONS.FEES_VIEW, PERMISSIONS.SELF_FEES_VIEW)
  @SkipEnvelope()
  @ApiOperation({ summary: 'Download a payment receipt' })
  async receipt(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
    @Query('refresh') refresh?: string,
  ) {
    const school = this.school(schoolId);
    await this.assertPaymentAccess(school, id, user);
    this.send(response, await this.documents.receipt(school, id, refresh === 'true'));
  }

  @Get('fee-statements/:studentId')
  @RequireAnyPermission(PERMISSIONS.FEES_VIEW, PERMISSIONS.SELF_FEES_VIEW)
  @SkipEnvelope()
  @ApiOperation({ summary: "Download a student's fee ledger for an academic year" })
  async feeStatement(
    @CurrentSchool() schoolId: string | null,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
    @Query('academicYearId') academicYearId?: string,
  ) {
    await this.assertStudentAccess(user, studentId, PERMISSIONS.FEES_VIEW);
    this.send(
      response,
      await this.documents.feeStatement(this.school(schoolId), studentId, academicYearId),
    );
  }

  @Get('report-cards/:id')
  @RequireAnyPermission(PERMISSIONS.REPORT_CARDS_VIEW, PERMISSIONS.SELF_RESULTS_VIEW)
  @SkipEnvelope()
  @ApiOperation({ summary: 'Download a report card' })
  async reportCard(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
    @Query('refresh') refresh?: string,
  ) {
    const school = this.school(schoolId);
    await this.assertReportCardAccess(school, id, user);
    this.send(response, await this.documents.reportCard(school, id, refresh === 'true'));
  }

  @Get('certificates/:id')
  @RequirePermissions(PERMISSIONS.CERTIFICATES_GENERATE)
  @SkipEnvelope()
  @ApiOperation({ summary: 'Download a certificate' })
  async certificate(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
    @Query('refresh') refresh?: string,
  ) {
    this.send(
      response,
      await this.documents.certificate(this.school(schoolId), id, refresh === 'true'),
    );
  }

  @Post('id-cards/students')
  @RequirePermissions(PERMISSIONS.ID_CARDS_GENERATE)
  @SkipEnvelope()
  @ApiOperation({ summary: 'Print a sheet of student ID cards' })
  async studentIdCards(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: IdCardBatchDto,
    @Res() response: Response,
  ) {
    this.send(response, await this.documents.studentIdCards(this.school(schoolId), dto.cardIds));
  }

  @Post('id-cards/staff')
  @RequirePermissions(PERMISSIONS.ID_CARDS_GENERATE)
  @SkipEnvelope()
  @ApiOperation({ summary: 'Print a sheet of staff ID cards' })
  async staffIdCards(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: IdCardBatchDto,
    @Res() response: Response,
  ) {
    this.send(response, await this.documents.staffIdCards(this.school(schoolId), dto.cardIds));
  }

  // --------------------------------------------------------------------------

  private send(response: Response, pdf: RenderedPdf): void {
    response
      .status(200)
      .set({
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.sizeBytes),
        'Content-Disposition': `inline; filename="${pdf.fileName}"`,
        // Personal documents must never be held by a shared cache.
        'Cache-Control': 'private, no-store',
      })
      .end(pdf.buffer);
  }

  /** A guardian or the student themselves may read their own documents. */
  private async assertStudentAccess(
    user: AuthenticatedUser,
    studentId: string,
    staffPermission: string,
  ): Promise<void> {
    if (user.isSuperAdmin || user.permissions.includes(staffPermission)) return;
    if (user.studentId === studentId) return;
    if (user.guardianId) {
      await this.guardians.assertChildAccess(user.guardianId, studentId);
      return;
    }
    throw new ForbiddenError('You do not have access to this document');
  }

  private async assertInvoiceAccess(
    schoolId: string,
    invoiceId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (user.isSuperAdmin || user.permissions.includes(PERMISSIONS.FEES_VIEW)) return;

    const invoice = await this.documents.ownerOf('invoice', schoolId, invoiceId);
    await this.assertStudentAccess(user, invoice, PERMISSIONS.FEES_VIEW);
  }

  private async assertPaymentAccess(
    schoolId: string,
    paymentId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (user.isSuperAdmin || user.permissions.includes(PERMISSIONS.FEES_VIEW)) return;

    const payment = await this.documents.ownerOf('payment', schoolId, paymentId);
    await this.assertStudentAccess(user, payment, PERMISSIONS.FEES_VIEW);
  }

  private async assertReportCardAccess(
    schoolId: string,
    reportCardId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (user.isSuperAdmin || user.permissions.includes(PERMISSIONS.REPORT_CARDS_VIEW)) return;

    const studentId = await this.documents.ownerOf('reportCard', schoolId, reportCardId);
    await this.assertStudentAccess(user, studentId, PERMISSIONS.REPORT_CARDS_VIEW);

    // An unpublished report card is not a parent's to read.
    await this.documents.assertReportCardPublished(schoolId, reportCardId);
  }

  private school(schoolId: string | null): string {
    if (!schoolId) {
      throw new ForbiddenError(
        'Select a school first. Super administrators must pass the X-School-Id header.',
      );
    }
    return schoolId;
  }
}
