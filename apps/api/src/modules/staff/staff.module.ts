import { Module } from '@nestjs/common';
import { AcademicsModule } from '../academics/academics.module';
import { UsersModule } from '../users/users.module';
import { StaffAttendanceService } from './staff-attendance.service';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [UsersModule, AcademicsModule],
  controllers: [StaffController],
  providers: [StaffService, StaffAttendanceService],
  exports: [StaffService, StaffAttendanceService],
})
export class StaffModule {}
