import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleType } from '@prisma/client';
import {
  RequirePermissions,
  RequireRoles,
  SkipTenantCheck,
} from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { MODULE_LABELS, ALL_MODULES } from '../../common/constants/modules';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { SchoolsService } from '../schools/schools.service';
import { CreateSchoolDto, UpdateSchoolDto } from '../schools/dto/school.dto';
import { PlatformService } from './platform.service';
import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';
import { UsageService } from './usage.service';
import {
  CancelSubscriptionDto,
  ChangePlanDto,
  CreatePlanDto,
  CreateSubscriptionDto,
  PlanQueryDto,
  PlatformSchoolQueryDto,
  RenewSubscriptionDto,
  SetLimitsDto,
  SetPlanActiveDto,
  SetSchoolModulesDto,
  SetSchoolStatusDto,
  SubscriptionQueryDto,
  UpdatePlanDto,
  UpdateSubscriptionDto,
} from './dto/platform.dto';

/**
 * Platform administration.
 *
 * Two independent locks on every route: `@RequireRoles(SUPER_ADMIN)` and a
 * `platform.*` permission. Only the super administrator role is seeded with
 * those permissions, and PermissionsGuard checks the role list on the
 * principal the server rebuilt from the database — a school admin cannot reach
 * anything here by editing a token or a URL.
 *
 * `@SkipTenantCheck` is what lets these routes run without a school context;
 * it does not relax authorisation.
 */
@ApiTags('Platform administration')
@ApiBearerAuth()
@RequireRoles(RoleType.SUPER_ADMIN)
@SkipTenantCheck()
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly plans: PlansService,
    private readonly subscriptions: SubscriptionsService,
    private readonly schools: SchoolsService,
    private readonly usage: UsageService,
  ) {}

  // --- Dashboard ------------------------------------------------------------

  @Get('overview')
  @RequirePermissions(PERMISSIONS.PLATFORM_ANALYTICS_VIEW)
  @ApiOperation({ summary: 'Platform dashboard: estate, revenue, support and recent activity' })
  overview() {
    return this.platform.overview();
  }

  @Get('growth')
  @RequirePermissions(PERMISSIONS.PLATFORM_ANALYTICS_VIEW)
  @ApiOperation({ summary: 'New schools, subscriptions and run rate by month' })
  growth(@Query('months', new ParseIntPipe({ optional: true })) months?: number) {
    return this.platform.growth(Math.min(Math.max(months ?? 12, 1), 36));
  }

  @Get('modules')
  @RequirePermissions(PERMISSIONS.PLATFORM_SCHOOLS_VIEW)
  @ApiOperation({ summary: 'The feature modules that can be sold and switched on' })
  modules() {
    return ALL_MODULES.map((key) => ({ key, label: MODULE_LABELS[key] }));
  }

  @Get('activity')
  @RequirePermissions(PERMISSIONS.PLATFORM_ANALYTICS_VIEW)
  @ApiOperation({ summary: 'Recent platform-level audit entries across every school' })
  activity(@Query('limit', new ParseIntPipe({ optional: true })) limit?: number) {
    return this.platform.schoolActivityFeed(Math.min(Math.max(limit ?? 50, 1), 200));
  }

  // --- Schools --------------------------------------------------------------

  @Get('schools')
  @RequirePermissions(PERMISSIONS.PLATFORM_SCHOOLS_VIEW)
  @ApiOperation({ summary: 'Every school with its subscription and headline usage' })
  listSchools(@Query() query: PlatformSchoolQueryDto) {
    return this.platform.listSchools(query);
  }

  @Post('schools')
  @RequirePermissions(PERMISSIONS.PLATFORM_SCHOOLS_CREATE)
  @ResponseMessage('School created')
  @ApiOperation({ summary: 'Provision a school with roles, an administrator and a trial' })
  createSchool(@Body() dto: CreateSchoolDto) {
    return this.schools.create(dto);
  }

  @Get('schools/:id')
  @RequirePermissions(PERMISSIONS.PLATFORM_SCHOOLS_VIEW)
  @ApiOperation({ summary: 'School profile, subscription, usage, modules and activity' })
  schoolDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.schoolDetail(id);
  }

  @Patch('schools/:id')
  @RequirePermissions(PERMISSIONS.PLATFORM_SCHOOLS_UPDATE)
  @ResponseMessage('School updated')
  @ApiOperation({ summary: "Update a school's profile" })
  updateSchool(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSchoolDto) {
    return this.schools.update(id, dto);
  }

  @Get('schools/:id/usage')
  @RequirePermissions(PERMISSIONS.PLATFORM_SCHOOLS_VIEW)
  @ApiOperation({ summary: 'Live usage against the limits in force for this school' })
  schoolUsage(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.schoolUsage(id);
  }

  @Get('schools/:id/activity')
  @RequirePermissions(PERMISSIONS.PLATFORM_SCHOOLS_VIEW)
  @ApiOperation({ summary: 'Recent audited activity within one school' })
  schoolActivity(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.platform.schoolActivity(id, limit ?? 50);
  }

  @Get('schools/:id/subscriptions')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUBSCRIPTIONS_MANAGE)
  @ApiOperation({ summary: 'Every subscription this school has held' })
  schoolSubscriptions(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.history(id);
  }

  @Patch('schools/:id/status')
  @RequirePermissions(PERMISSIONS.PLATFORM_SCHOOLS_SUSPEND)
  @ResponseMessage('School status updated')
  @ApiOperation({ summary: 'Suspend, reactivate, expire or archive a school' })
  setSchoolStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetSchoolStatusDto) {
    return this.platform.setSchoolStatus(id, dto);
  }

  @Patch('schools/:id/modules')
  @RequirePermissions(PERMISSIONS.PLATFORM_SCHOOLS_UPDATE)
  @ResponseMessage('Modules updated')
  @ApiOperation({ summary: 'Enable or disable feature modules for one school' })
  setSchoolModules(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetSchoolModulesDto) {
    return this.platform.setSchoolModules(id, dto);
  }

  // --- Plans ----------------------------------------------------------------

  @Get('plans')
  @RequirePermissions(PERMISSIONS.PLATFORM_PLANS_MANAGE)
  @ApiOperation({ summary: 'The subscription plan catalogue' })
  listPlans(@Query() query: PlanQueryDto) {
    return this.plans.findAll(query);
  }

  @Post('plans')
  @RequirePermissions(PERMISSIONS.PLATFORM_PLANS_MANAGE)
  @ResponseMessage('Plan created')
  @ApiOperation({ summary: 'Add a plan with its limits and module entitlements' })
  createPlan(@Body() dto: CreatePlanDto) {
    return this.plans.create(dto);
  }

  @Get('plans/:id')
  @RequirePermissions(PERMISSIONS.PLATFORM_PLANS_MANAGE)
  @ApiOperation({ summary: 'One plan with how many schools are on it' })
  planDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.findOne(id);
  }

  @Patch('plans/:id')
  @RequirePermissions(PERMISSIONS.PLATFORM_PLANS_MANAGE)
  @ResponseMessage('Plan updated')
  @ApiOperation({ summary: 'Change a plan’s pricing, limits or modules' })
  updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto) {
    return this.plans.update(id, dto);
  }

  @Patch('plans/:id/active')
  @RequirePermissions(PERMISSIONS.PLATFORM_PLANS_MANAGE)
  @ResponseMessage('Plan availability updated')
  @ApiOperation({ summary: 'Stop or resume selling a plan without touching live subscriptions' })
  setPlanActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPlanActiveDto) {
    return this.plans.setActive(id, dto);
  }

  // --- Subscriptions --------------------------------------------------------

  @Get('subscriptions')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUBSCRIPTIONS_MANAGE)
  @ApiOperation({ summary: 'Every subscription, filterable by status, plan and expiry window' })
  listSubscriptions(@Query() query: SubscriptionQueryDto) {
    return this.subscriptions.findAll(query);
  }

  @Post('subscriptions')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUBSCRIPTIONS_MANAGE)
  @ResponseMessage('Subscription created')
  @ApiOperation({ summary: 'Put a school on a plan, superseding its current subscription' })
  createSubscription(@Body() dto: CreateSubscriptionDto) {
    return this.subscriptions.create(dto);
  }

  @Get('subscriptions/:id')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUBSCRIPTIONS_MANAGE)
  @ApiOperation({ summary: 'One subscription with the school’s usage against it' })
  subscriptionDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.findOne(id);
  }

  @Patch('subscriptions/:id')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUBSCRIPTIONS_MANAGE)
  @ResponseMessage('Subscription updated')
  @ApiOperation({ summary: 'Adjust dates, status, price or auto-renewal' })
  updateSubscription(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSubscriptionDto) {
    return this.subscriptions.update(id, dto);
  }

  @Patch('subscriptions/:id/plan')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUBSCRIPTIONS_MANAGE)
  @ResponseMessage('Plan changed')
  @ApiOperation({ summary: 'Move a school to another plan and realign its modules' })
  changePlan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangePlanDto) {
    return this.subscriptions.changePlan(id, dto);
  }

  @Patch('subscriptions/:id/limits')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUBSCRIPTIONS_MANAGE)
  @ResponseMessage('Limits updated')
  @ApiOperation({ summary: 'Override the plan limits for this school alone' })
  setLimits(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetLimitsDto) {
    return this.subscriptions.setLimits(id, dto);
  }

  @Post('subscriptions/:id/renew')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUBSCRIPTIONS_MANAGE)
  @ResponseMessage('Subscription renewed')
  @ApiOperation({ summary: 'Extend the subscription by a further billing cycle' })
  renew(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RenewSubscriptionDto) {
    return this.subscriptions.renew(id, dto);
  }

  @Post('subscriptions/:id/cancel')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUBSCRIPTIONS_MANAGE)
  @ResponseMessage('Subscription cancelled')
  @ApiOperation({ summary: 'Cancel at the end of the paid period, or immediately' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelSubscriptionDto) {
    return this.subscriptions.cancel(id, dto);
  }

  // --- Audit ----------------------------------------------------------------

  @Get('audit')
  @RequirePermissions(PERMISSIONS.PLATFORM_ANALYTICS_VIEW)
  @ApiOperation({ summary: 'Platform-scoped audit trail' })
  audit(@Query() query: PaginationQueryDto) {
    return this.platform.platformAudit(query);
  }
}
