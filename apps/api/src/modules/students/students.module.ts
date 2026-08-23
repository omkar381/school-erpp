import { Module } from '@nestjs/common';
import { AcademicsModule } from '../academics/academics.module';
import { UsersModule } from '../users/users.module';
import { StudentExportService } from './student-export.service';
import { StudentImportService } from './student-import.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [UsersModule, AcademicsModule],
  controllers: [StudentsController],
  providers: [StudentsService, StudentImportService, StudentExportService],
  exports: [StudentsService],
})
export class StudentsModule {}
