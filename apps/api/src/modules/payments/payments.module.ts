import { Module } from '@nestjs/common';
import { AcademicsModule } from '../academics/academics.module';
import { FeesModule } from '../fees/fees.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './services/payments.service';
import { RazorpayService } from './services/razorpay.service';

@Module({
  imports: [FeesModule, AcademicsModule, GuardiansModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, RazorpayService],
  exports: [PaymentsService, RazorpayService],
})
export class PaymentsModule {}
