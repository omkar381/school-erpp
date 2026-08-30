import { Module } from '@nestjs/common';
import { StudentsModule } from '../students/students.module';
import { AdmissionsController } from './admissions.controller';
import { AdmissionsService } from './admissions.service';

@Module({
  imports: [StudentsModule],
  controllers: [AdmissionsController],
  providers: [AdmissionsService],
  exports: [AdmissionsService],
})
export class AdmissionsModule {}
