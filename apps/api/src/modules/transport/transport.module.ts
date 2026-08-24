import { Module } from '@nestjs/common';
import { AcademicsModule } from '../academics/academics.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { TransportController } from './transport.controller';
import { TransportService } from './transport.service';

@Module({
  imports: [AcademicsModule, GuardiansModule],
  controllers: [TransportController],
  providers: [TransportService],
  exports: [TransportService],
})
export class TransportModule {}
