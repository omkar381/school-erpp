import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiSchoolHeader, CurrentSchool, CurrentUser } from '../../common/decorators';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth()
@ApiSchoolHeader()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @ApiOperation({
    summary: "The signed-in user's dashboard, shaped by what their role actually does",
  })
  forUser(@CurrentSchool() schoolId: string | null, @CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.forUser(schoolId, user);
  }
}
