import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiSchoolHeader, CurrentSchool, RequireModule, RequirePermissions } from '../../common/decorators';
import { MODULES } from '../../common/constants/modules';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { COMPONENT_CALCS, COMPONENT_PRESETS, COMPONENT_TYPES } from './payroll.types';
import { PayrollService } from './payroll.service';
import {
  CreateSalaryStructureDto,
  PayrollRegisterQueryDto,
  PreviewSalaryDto,
  SalaryStructureQueryDto,
  UpdateSalaryStructureDto,
} from './dto/payroll.dto';

/**
 * Salary structures and the monthly register.
 *
 * Viewing pay is separated from setting it: PAYROLL_VIEW is enough to read the
 * register a finance clerk works from, while every write needs PAYROLL_MANAGE.
 */
@ApiTags('Payroll')
@ApiBearerAuth()
@ApiSchoolHeader()
@RequireModule(MODULES.PAYROLL)
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('statistics')
  @RequirePermissions(PERMISSIONS.PAYROLL_VIEW)
  @ApiOperation({ summary: 'Headcount on payroll and the monthly wage bill' })
  statistics(@CurrentSchool() schoolId: string) {
    return this.payroll.statistics(schoolId);
  }

  @Get('components')
  @RequirePermissions(PERMISSIONS.PAYROLL_VIEW)
  @ApiOperation({ summary: 'Component presets and the types the form accepts' })
  components() {
    return {
      types: COMPONENT_TYPES,
      calcs: COMPONENT_CALCS,
      presets: COMPONENT_PRESETS,
    };
  }

  @Get('register')
  @RequirePermissions(PERMISSIONS.PAYROLL_VIEW)
  @ApiOperation({ summary: 'Who gets paid what for a given month, with totals' })
  register(@CurrentSchool() schoolId: string, @Query() query: PayrollRegisterQueryDto) {
    return this.payroll.register(schoolId, query);
  }

  @Get('unassigned')
  @RequirePermissions(PERMISSIONS.PAYROLL_VIEW)
  @ApiOperation({ summary: 'Payable staff with no salary structure in force' })
  unassigned(@CurrentSchool() schoolId: string) {
    return this.payroll.unassignedStaff(schoolId);
  }

  @Get('structures')
  @RequirePermissions(PERMISSIONS.PAYROLL_VIEW)
  @ApiOperation({ summary: 'Salary structures, current-only by default' })
  list(@CurrentSchool() schoolId: string, @Query() query: SalaryStructureQueryDto) {
    return this.payroll.list(schoolId, query);
  }

  @Post('structures')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ResponseMessage('Salary structure saved')
  @ApiOperation({ summary: 'Set a salary, superseding the previous structure' })
  create(@CurrentSchool() schoolId: string, @Body() dto: CreateSalaryStructureDto) {
    return this.payroll.create(schoolId, dto);
  }

  @Post('preview')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiOperation({ summary: 'What a basic and its components would pay, without saving' })
  preview(@Body() dto: PreviewSalaryDto) {
    return this.payroll.preview(dto);
  }

  @Get('staff/:staffId')
  @RequirePermissions(PERMISSIONS.PAYROLL_VIEW)
  @ApiOperation({ summary: 'One employee\'s current salary and its full history' })
  history(
    @CurrentSchool() schoolId: string,
    @Param('staffId', ParseUUIDPipe) staffId: string,
  ) {
    return this.payroll.historyFor(schoolId, staffId);
  }

  @Get('structures/:id')
  @RequirePermissions(PERMISSIONS.PAYROLL_VIEW)
  @ApiOperation({ summary: 'One salary structure with its component breakdown' })
  detail(@CurrentSchool() schoolId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.findOne(schoolId, id);
  }

  @Patch('structures/:id')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ResponseMessage('Salary structure updated')
  @ApiOperation({ summary: 'Correct a structure in place, keeping its dates' })
  update(
    @CurrentSchool() schoolId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSalaryStructureDto,
  ) {
    return this.payroll.update(schoolId, id, dto);
  }

  @Delete('structures/:id')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ResponseMessage('Salary structure removed')
  @ApiOperation({ summary: 'Remove a structure, reopening the one it superseded' })
  remove(@CurrentSchool() schoolId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.remove(schoolId, id);
  }
}
