import { Global, Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { EmailService } from './channels/email.service';
import { PushService } from './channels/push.service';
import { SmsService } from './channels/sms.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  imports: [RealtimeModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, EmailService, SmsService, PushService],
  exports: [NotificationsService, EmailService, SmsService, PushService],
})
export class NotificationsModule {}
