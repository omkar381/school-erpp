import { Module } from '@nestjs/common';
import { GuardiansModule } from '../guardians/guardians.module';
import { HomeworkController } from './homework.controller';
import { HomeworkService } from './homework.service';

@Module({
  imports: [GuardiansModule],
  controllers: [HomeworkController],
  providers: [HomeworkService],
  exports: [HomeworkService],
})
export class HomeworkModule {}
