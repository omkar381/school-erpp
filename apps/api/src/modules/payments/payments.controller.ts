import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  ApiSchoolHeader,
  CurrentSchool,
  CurrentUser,
  Public,
  RequireAnyPermission,
  RequireModule,
  RequirePermissions,
} from '../../common/decorators';
import { MODULES } from '../../common/constants/modules';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage, SkipEnvelope } from '../../common/interceptors/response.interceptor';
import { BadRequestError, ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { GuardiansService } from '../guardians/guardians.service';
import { PaymentsService } from './services/payments.service';
import { RazorpayService } from './services/razorpay.service';
import {
  ApproveRefundDto,
  CollectPaymentDto,
  CreateOrderDto,
  FailPaymentDto,
  PaymentQueryDto,
  RefundQueryDto,
  RequestRefundDto,
  VerifyPaymentDto,
} from './dto/payment.dto';

@ApiTags('Payments')
@ApiSchoolHeader()
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly razorpay: RazorpayService,
    private readonly guardians: GuardiansService,
  ) {}

  // --- Webhook (public, signature-verified) ---------------------------------

  @Public()
  @Post('webhooks/razorpay')
  @HttpCode(HttpStatus.OK)
  @SkipEnvelope()
  @ApiExcludeEndpoint()
  async razorpayWebhook(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('x-razorpay-signature') signature: string,
  ) {
    if (!request.rawBody) {
      throw new BadRequestError('The raw request body was not available for verification');
    }
    if (!signature) {
      throw new BadRequestError('Missing webhook signature');
    }

    // The gateway expects a 200 even for events we do not act on, otherwise it
    // retries indefinitely.
    return this.razorpay.handleWebhook(request.rawBody, signature);
  }

  // --- Online payment (parent-facing) ---------------------------------------

  @Get('gateway/config')
  @ApiBearerAuth()
  @RequireModule(MODULES.PAYMENTS)
  @ApiOperation({ summary: 'Publishable gateway key for the checkout widget' })
  gatewayConfig() {
    return this.razorpay.getPublicKey();
  }

  @Post('orders')
  @ApiBearerAuth()
  @RequireModule(MODULES.PAYMENTS)
  @RequireAnyPermission(PERMISSIONS.SELF_FEES_PAY, PERMISSIONS.FEES_COLLECT)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ResponseMessage('Payment order created')
  @ApiOperation({ summary: 'Create a gateway order; the server computes the amount' })
  createOrder(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: CreateOrderDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.razorpay.createOrder(this.school(schoolId), dto, userId);
  }

  @Post('verify')
  @ApiBearerAuth()
  @RequireModule(MODULES.PAYMENTS)
  @RequireAnyPermission(PERMISSIONS.SELF_FEES_PAY, PERMISSIONS.FEES_COLLECT)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Payment verified')
  @ApiOperation({ summary: 'Verify the checkout signature and credit the payment' })
  verify(@CurrentSchool() schoolId: string | null, @Body() dto: VerifyPaymentDto) {
    return this.razorpay.verifyAndSettle(this.school(schoolId), dto);
  }

  @Post('reconcile')
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.FEES_COLLECT)
  @ResponseMessage('Reconciliation completed')
  @ApiOperation({ summary: 'Ask the gateway what happened to pending payments' })
  reconcile(@CurrentSchool() schoolId: string | null) {
    return this.razorpay.reconcile(this.school(schoolId));
  }

  // --- Counter collection ---------------------------------------------------

  @Get()
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'List payments with collection totals' })
  findAll(@CurrentSchool() schoolId: string | null, @Query() query: PaymentQueryDto) {
    return this.payments.findAll(this.school(schoolId), query);
  }

  @Get('refunds')
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.FEES_VIEW)
  @ApiOperation({ summary: 'List refunds' })
  listRefunds(@CurrentSchool() schoolId: string | null, @Query() query: RefundQueryDto) {
    return this.payments.listRefunds(this.school(schoolId), query.status);
  }

  @Get(':id')
  @ApiBearerAuth()
  @RequireAnyPermission(PERMISSIONS.FEES_VIEW, PERMISSIONS.SELF_FEES_VIEW)
  @ApiOperation({ summary: 'Payment detail and receipt data' })
  async findOne(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const payment = await this.payments.findOne(this.school(schoolId), id);
    await this.assertStudentAccess(user, payment.studentId);
    return payment;
  }

  @Post('collect')
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.FEES_COLLECT)
  @ResponseMessage('Payment recorded')
  @ApiOperation({ summary: 'Record an offline payment and allocate it to invoices' })
  collect(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: CollectPaymentDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.payments.collect(this.school(schoolId), dto, userId);
  }

  @Post(':id/clear')
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.FEES_COLLECT)
  @ResponseMessage('Cheque cleared')
  @ApiOperation({ summary: 'Mark a cheque as cleared' })
  clearCheque(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.payments.clearCheque(this.school(schoolId), id, userId);
  }

  @Post(':id/fail')
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.FEES_COLLECT)
  @ResponseMessage('Payment marked as failed')
  @ApiOperation({ summary: 'Mark a payment as failed, restoring the invoice balance' })
  failPayment(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FailPaymentDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.payments.failPayment(this.school(schoolId), id, dto.reason, userId);
  }

  // --- Refunds --------------------------------------------------------------

  @Post('refunds')
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.FEES_REFUND)
  @ResponseMessage('Refund requested')
  @ApiOperation({ summary: 'Request a refund against a settled payment' })
  requestRefund(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: RequestRefundDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.payments.requestRefund(this.school(schoolId), dto, userId);
  }

  @Post('refunds/:id/decide')
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.FEES_REFUND)
  @ResponseMessage('Refund decision recorded')
  @ApiOperation({ summary: 'Approve or reject a refund; approval moves the money' })
  decideRefund(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveRefundDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.payments.approveRefund(this.school(schoolId), id, dto, userId);
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
