import { Global, Module } from '@nestjs/common';
import { SchoolsModule } from '../schools/schools.module';
import { SupportModule } from '../support/support.module';
import { PlansService } from './plans.service';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { SchoolSubscriptionController } from './subscription.controller';
import { SubscriptionSchedulerService } from './subscription-scheduler.service';
import { SubscriptionsService } from './subscriptions.service';
import { UsageService } from './usage.service';

/**
 * Platform administration, subscriptions and usage.
 *
 * Global because UsageService is the single place that decides whether a school
 * may add another student, member of staff or file — the domain modules that
 * enforce those limits inject it directly rather than each importing this
 * module and risking a cycle back through SchoolsModule.
 */
@Global()
@Module({
  imports: [SchoolsModule, SupportModule],
  controllers: [PlatformController, SchoolSubscriptionController],
  providers: [
    PlatformService,
    PlansService,
    SubscriptionsService,
    SubscriptionSchedulerService,
    UsageService,
  ],
  exports: [PlatformService, PlansService, SubscriptionsService, UsageService],
})
export class PlatformModule {}
