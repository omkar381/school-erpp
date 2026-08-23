import { Module } from '@nestjs/common';
import { AcademicsModule } from '../academics/academics.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { ExamsController } from './exams.controller';
import { ExamsService } from './services/exams.service';
import { GradingService } from './services/grading.service';
import { MarksService } from './services/marks.service';
import { ReportCardsService } from './services/report-cards.service';

@Module({
  imports: [AcademicsModule, GuardiansModule],
  controllers: [ExamsController],
  providers: [ExamsService, MarksService, GradingService, ReportCardsService],
  exports: [ExamsService, MarksService, GradingService, ReportCardsService],
})
export class ExamsModule {}
