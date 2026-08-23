import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import {
  ApiSchoolHeader,
  CurrentSchool,
  CurrentUser,
  RequireAnyPermission,
  RequireModule,
  RequirePermissions,
} from '../../common/decorators';
import { MODULES } from '../../common/constants/modules';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { GuardiansService } from '../guardians/guardians.service';
import { FeeStructuresService } from './services/fee-structures.service';
import { InvoicesService } from './services/invoices.service';
import { FinanceDashboardService } from './services/finance-dashboard.service';
import {
  CancelInvoiceDto,
  CreateDiscountDto,
  CreateFeeHeadDto,
  CreateFeeStructureDto,
  CreateInvoiceDto,
  FeeStructureQueryDto,
  GenerateInvoicesDto,
  GrantDiscountDto,
  InvoiceQueryDto,
  UpdateFeeStructureDto,
} from './dto/fees.dto';

class DashboardQuery {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID('4')
  academicYearId?: string;
}

class DateRangeQuery {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}

class RevokeDiscountDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

@ApiTags('Fees')
@ApiBearerAuth()
@ApiSchoolHeader()
@RequireModule(MODULES.FEES)
@Controller('fees')
export class FeesController {
  constructor(
    private readonly structures: FeeStructuresService,
    private readonly invoices: InvoicesService,
    private readonly dashboard: FinanceDashboardService,
    private readonly guardians: GuardiansService,
  ) {}

  // --- Dashboard and reports ------------------------------------------------

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.FINANCE_DASHBOARD_VIEW)
  @ApiOperation({ summary: 'Finance dashboard: collection, dues, trends and defaulters' })
  getDashboard(@CurrentSchool() schoolId: string | null, @Query() query: DashboardQuery) {
    return this.dashboard.build(this.school(schoolId), query);
  }

  @Get('reports/collection')
  @RequirePermissions(PERMISSIONS.FEES_REPORTS)
  @ApiOperation({ summary: 'Day-by-day collection report' })
  collectionReport(@CurrentSchool() schoolId: string | null, @Query() query: DateRangeQuery) {
    return this.dashboard.dailyCollection(this.school(schoolId), query.from, query.to);
  }

  @Get('reports/outstanding')
  @RequirePermissions(PERMISSIONS.FEES_REPORTS)
  @ApiOperation({ summary: 'Outstanding fees with receivables ageing' })
  outstandingReport(
    @CurrentSchool() schoolId: string | null,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.dashboard.outstandingReport(this.school(schoolId), academicYearId);
  }

  // --- Fee heads ------------------------------------------------------------

  @Get('heads')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'List fee heads' })
  listHeads(@CurrentSchool() schoolId: string | null, @Query('includeInactive') inactive?: string) {
    return this.structures.listHeads(this.school(schoolId), inactive === 'true');
  }

  @Post('heads')
  @RequirePermissions(PERMISSIONS.FEES_STRUCTURE_MANAGE)
  @ResponseMessage('Fee head created')
  @ApiOperation({ summary: 'Create a fee head' })
  createHead(@CurrentSchool() schoolId: string | null, @Body() dto: CreateFeeHeadDto) {
    return this.structures.createHead(this.school(schoolId), dto);
  }

  @Patch('heads/:id')
  @RequirePermissions(PERMISSIONS.FEES_STRUCTURE_MANAGE)
  @ResponseMessage('Fee head updated')
  @ApiOperation({ summary: 'Update a fee head' })
  updateHead(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<CreateFeeHeadDto> & { isActive?: boolean },
  ) {
    return this.structures.updateHead(this.school(schoolId), id, dto);
  }

  @Delete('heads/:id')
  @RequirePermissions(PERMISSIONS.FEES_STRUCTURE_MANAGE)
  @ResponseMessage('Fee head deleted')
  @ApiOperation({ summary: 'Delete a fee head that has never been billed' })
  removeHead(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.structures.removeHead(this.school(schoolId), id);
  }

  // --- Fee structures -------------------------------------------------------

  @Get('structures')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'List fee structures with items and installments' })
  listStructures(@CurrentSchool() schoolId: string | null, @Query() query: FeeStructureQueryDto) {
    return this.structures.findAll(this.school(schoolId), query);
  }

  @Get('structures/:id')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'Get one fee structure' })
  getStructure(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.structures.findOne(this.school(schoolId), id);
  }

  @Post('structures')
  @RequirePermissions(PERMISSIONS.FEES_STRUCTURE_MANAGE)
  @ResponseMessage('Fee structure created')
  @ApiOperation({ summary: 'Create a fee structure with items and installments' })
  createStructure(@CurrentSchool() schoolId: string | null, @Body() dto: CreateFeeStructureDto) {
    return this.structures.create(this.school(schoolId), dto);
  }

  @Patch('structures/:id')
  @RequirePermissions(PERMISSIONS.FEES_STRUCTURE_MANAGE)
  @ResponseMessage('Fee structure updated')
  @ApiOperation({ summary: 'Update a fee structure that has not been invoiced' })
  updateStructure(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFeeStructureDto,
  ) {
    return this.structures.update(this.school(schoolId), id, dto);
  }

  @Delete('structures/:id')
  @RequirePermissions(PERMISSIONS.FEES_STRUCTURE_MANAGE)
  @ResponseMessage('Fee structure deleted')
  @ApiOperation({ summary: 'Delete an unused fee structure' })
  removeStructure(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.structures.remove(this.school(schoolId), id);
  }

  // --- Discounts ------------------------------------------------------------

  @Get('discounts')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'List discounts and scholarships' })
  listDiscounts(@CurrentSchool() schoolId: string | null) {
    return this.structures.listDiscounts(this.school(schoolId));
  }

  @Post('discounts')
  @RequirePermissions(PERMISSIONS.FEES_DISCOUNT_MANAGE)
  @ResponseMessage('Discount created')
  @ApiOperation({ summary: 'Create a discount or scholarship' })
  createDiscount(@CurrentSchool() schoolId: string | null, @Body() dto: CreateDiscountDto) {
    return this.structures.createDiscount(this.school(schoolId), dto);
  }

  @Post('discounts/grant')
  @RequirePermissions(PERMISSIONS.FEES_DISCOUNT_MANAGE)
  @ResponseMessage('Discount granted')
  @ApiOperation({ summary: 'Award a discount to a student' })
  grantDiscount(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: GrantDiscountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const canApprove =
      user.isSuperAdmin || user.permissions.includes(PERMISSIONS.FEES_DISCOUNT_APPROVE);
    return this.structures.grantDiscount(this.school(schoolId), dto, user.id, canApprove);
  }

  @Delete('discounts/grants/:id')
  @RequirePermissions(PERMISSIONS.FEES_DISCOUNT_MANAGE)
  @ResponseMessage('Discount revoked')
  @ApiOperation({ summary: 'Revoke a granted discount' })
  revokeDiscount(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokeDiscountDto,
  ) {
    return this.structures.revokeDiscount(this.school(schoolId), id, dto.reason);
  }

  // --- Invoices -------------------------------------------------------------

  @Get('invoices')
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'List invoices with totals' })
  listInvoices(@CurrentSchool() schoolId: string | null, @Query() query: InvoiceQueryDto) {
    return this.invoices.findAll(this.school(schoolId), query);
  }

  @Get('invoices/:id')
  @RequireAnyPermission(PERMISSIONS.FEES_VIEW, PERMISSIONS.SELF_FEES_VIEW)
  @ApiOperation({ summary: 'Full invoice with line items and payments' })
  async getInvoice(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const invoice = await this.invoices.findOne(this.school(schoolId), id);
    await this.assertStudentAccess(user, invoice.studentId);
    return invoice;
  }

  @Post('invoices')
  @RequirePermissions(PERMISSIONS.FEES_INVOICE_CREATE)
  @ResponseMessage('Invoice raised')
  @ApiOperation({ summary: 'Raise a one-off invoice' })
  createInvoice(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: CreateInvoiceDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.invoices.create(this.school(schoolId), dto, userId);
  }

  @Post('invoices/generate')
  @RequirePermissions(PERMISSIONS.FEES_INVOICE_CREATE)
  @ResponseMessage('Invoices generated')
  @ApiOperation({ summary: 'Raise invoices in bulk from a fee structure' })
  generateInvoices(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: GenerateInvoicesDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.invoices.generateBulk(this.school(schoolId), dto, userId);
  }

  @Post('invoices/:id/cancel')
  @RequirePermissions(PERMISSIONS.FEES_INVOICE_CANCEL)
  @ResponseMessage('Invoice cancelled')
  @ApiOperation({ summary: 'Cancel or void an unpaid invoice' })
  cancelInvoice(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelInvoiceDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.invoices.cancel(this.school(schoolId), id, dto, userId);
  }

  @Post('apply-late-fees')
  @RequirePermissions(PERMISSIONS.FEES_STRUCTURE_MANAGE)
  @ResponseMessage('Late fees applied')
  @ApiOperation({ summary: 'Recalculate late fees on overdue invoices' })
  applyLateFees(@CurrentSchool() schoolId: string | null) {
    return this.invoices.applyLateFees(this.school(schoolId));
  }

  // --- Student view ---------------------------------------------------------

  @Get('students/:studentId/ledger')
  @RequireAnyPermission(PERMISSIONS.FEES_VIEW, PERMISSIONS.SELF_FEES_VIEW)
  @ApiOperation({ summary: "A student's invoices, payments and running balance" })
  async studentLedger(
    @CurrentSchool() schoolId: string | null,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('academicYearId') academicYearId?: string,
  ) {
    await this.assertStudentAccess(user, studentId);
    return this.invoices.studentLedger(this.school(schoolId), studentId, academicYearId);
  }

  // --------------------------------------------------------------------------

  private async assertStudentAccess(user: AuthenticatedUser, studentId: string): Promise<void> {
    if (user.isSuperAdmin || user.permissions.includes(PERMISSIONS.FEES_VIEW)) return;
    if (user.studentId === studentId) return;
    if (user.guardianId) {
      await this.guardians.assertChildAccess(user.guardianId, studentId);
      return;
    }
    throw new ForbiddenError('You do not have access to this student');
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
