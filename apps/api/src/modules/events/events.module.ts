import { Module } from '@nestjs/common';
import { AcademicsModule } from '../academics/academics.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [AcademicsModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
