import { Module } from '@nestjs/common';
import { GuardiansModule } from '../guardians/guardians.module';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';

@Module({
  imports: [GuardiansModule],
  controllers: [LibraryController],
  providers: [LibraryService],
  exports: [LibraryService],
})
export class LibraryModule {}
