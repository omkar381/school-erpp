import { Module } from '@nestjs/common';
import { AcademicsController } from './academics.controller';
import { AcademicYearService } from './services/academic-year.service';
import { CalendarService } from './services/calendar.service';
import { ClassesService } from './services/classes.service';
import { SubjectsService } from './services/subjects.service';

@Module({
  controllers: [AcademicsController],
  providers: [AcademicYearService, ClassesService, SubjectsService, CalendarService],
  exports: [AcademicYearService, ClassesService, SubjectsService, CalendarService],
})
export class AcademicsModule {}
