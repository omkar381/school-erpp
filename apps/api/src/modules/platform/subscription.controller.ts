import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TicketPriority } from '@prisma/client';
import {
  ApiSchoolHeader,
  CurrentSchool,
  CurrentUser,
  RequirePermissions,
} from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { SupportService } from '../support/support.service';
import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';
import { UsageService } from './usage.service';
import { UpgradeRequestDto } from './dto/platform.dto';

/**
 * The school's own read-only view of what it is paying for.
 *
 * Everything is resolved from the caller's pinned tenant, never from a body or
 * query parameter — that is what stops one school from reading, let alone
 * changing, another school's subscription. Changes to a subscription live
 * entirely on the platform routes.
 */
@ApiTags('Subscription (school)')
@ApiBearerAuth()
@ApiSchoolHeader()
@Controller('subscription')
export class SchoolSubscriptionController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly plans: PlansService,
    private readonly usage: UsageService,
    private readonly support: SupportService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SCHOOL_VIEW)
  @ApiOperation({ summary: 'Current plan, status, trial, renewal date, usage and modules' })
  current(@CurrentSchool() schoolId: string | null) {
    return this.subscriptions.currentForSchool(this.school(schoolId));
  }

  @Get('usage')
  @RequirePermissions(PERMISSIONS.SCHOOL_VIEW)
  @ApiOperation({ summary: 'Live student, staff and storage usage against the limits' })
  usageSummary(@CurrentSchool() schoolId: string | null) {
    return this.usage.forSchool(this.school(schoolId), { fresh: true });
  }

  @Get('plans')
  @RequirePermissions(PERMISSIONS.SCHOOL_VIEW)
  @ApiOperation({ summary: 'Plans available to upgrade to' })
  availablePlans() {
    return this.plans.listSellable();
  }

  /**
   * Upgrades are handled by the platform team rather than self-serve billing,
   * so the request becomes a support ticket — one queue, one audit trail, and
   * no payment flow the product does not have yet.
   */
  @Post('upgrade-request')
  @RequirePermissions(PERMISSIONS.SCHOOL_UPDATE)
  @ResponseMessage('Upgrade request sent — our team will be in touch')
  @ApiOperation({ summary: 'Ask the platform team to change this school’s plan' })
  async requestUpgrade(
    @CurrentSchool() schoolId: string | null,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpgradeRequestDto,
  ) {
    const id = this.school(schoolId);
    const current = await this.subscriptions.currentForSchool(id);
    const target = dto.planId
      ? (await this.plans.listSellable()).find((plan) => plan.id === dto.planId)
      : undefined;

    const lines = [
      `Current plan: ${current.plan?.name ?? 'none'}`,
      `Requested plan: ${target?.name ?? 'not specified'}`,
      `Students: ${current.usage.students.used}/${current.usage.students.limit}`,
      `Staff: ${current.usage.staff.used}/${current.usage.staff.limit}`,
      dto.message ? `\n${dto.message}` : '',
    ];

    return this.support.create(id, user, {
      subject: target ? `Upgrade request: ${target.name}` : 'Subscription upgrade request',
      category: 'BILLING',
      priority: TicketPriority.HIGH,
      description: lines.filter(Boolean).join('\n'),
    });
  }

  private school(schoolId: string | null): string {
    if (!schoolId) throw new ForbiddenError('This account is not associated with a school');
    return schoolId;
  }
}
