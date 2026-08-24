import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiSchoolHeader,
  CurrentSchool,
  CurrentUser,
  RequireAnyPermission,
  RequireModule,
  RequirePermissions,
} from '../../common/decorators';
import { MODULES } from '../../common/constants/modules';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { GuardiansService } from '../guardians/guardians.service';
import { LibraryService } from './library.service';
import {
  AddCopiesDto,
  BookQueryDto,
  CreateBookDto,
  IssueBookDto,
  IssueQueryDto,
  ReturnBookDto,
  SettleFineDto,
  WaiveFineDto,
} from './dto/library.dto';

@ApiTags('Library')
@ApiBearerAuth()
@ApiSchoolHeader()
@RequireModule(MODULES.LIBRARY)
@Controller('library')
export class LibraryController {
  constructor(
    private readonly library: LibraryService,
    private readonly guardians: GuardiansService,
  ) {}

  @Get('statistics')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Holdings, circulation and outstanding fine summary' })
  statistics(@CurrentSchool() schoolId: string | null) {
    return this.library.statistics(this.school(schoolId));
  }

  // --- Catalogue ------------------------------------------------------------

  @Get('books')
  @RequireAnyPermission(PERMISSIONS.LIBRARY_VIEW, PERMISSIONS.SELF_LIBRARY_VIEW)
  @ApiOperation({ summary: 'Search the catalogue by title, author, ISBN or publisher' })
  searchBooks(@CurrentSchool() schoolId: string | null, @Query() query: BookQueryDto) {
    return this.library.searchBooks(this.school(schoolId), query);
  }

  @Get('books/:id')
  @RequireAnyPermission(PERMISSIONS.LIBRARY_VIEW, PERMISSIONS.SELF_LIBRARY_VIEW)
  @ApiOperation({ summary: 'Book detail with every copy and who holds it' })
  getBook(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.library.getBook(this.school(schoolId), id);
  }

  @Post('books')
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Book catalogued')
  @ApiOperation({ summary: 'Catalogue a title and accession its copies' })
  createBook(@CurrentSchool() schoolId: string | null, @Body() dto: CreateBookDto) {
    return this.library.createBook(this.school(schoolId), dto);
  }

  @Post('books/:id/copies')
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Copies added')
  @ApiOperation({ summary: 'Accession further copies of an existing title' })
  addCopies(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCopiesDto,
  ) {
    return this.library.addCopies(this.school(schoolId), id, dto.count);
  }

  // --- Circulation ----------------------------------------------------------

  @Get('issues')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Circulation register with overdue days and fines' })
  listIssues(@CurrentSchool() schoolId: string | null, @Query() query: IssueQueryDto) {
    return this.library.listIssues(this.school(schoolId), query);
  }

  @Post('issues')
  @RequirePermissions(PERMISSIONS.LIBRARY_ISSUE)
  @ResponseMessage('Book issued')
  @ApiOperation({ summary: 'Issue a copy, enforcing loan limits and unpaid fines' })
  issue(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: IssueBookDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.library.issue(this.school(schoolId), dto, user.id);
  }

  @Post('issues/:id/return')
  @RequirePermissions(PERMISSIONS.LIBRARY_RETURN)
  @ResponseMessage('Book returned')
  @ApiOperation({ summary: 'Record a return and raise any overdue or damage fine' })
  returnBook(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnBookDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.library.returnBook(this.school(schoolId), id, dto, user.id);
  }

  @Post('issues/:id/renew')
  @RequirePermissions(PERMISSIONS.LIBRARY_ISSUE)
  @ResponseMessage('Loan renewed')
  @ApiOperation({ summary: 'Extend a loan within the renewal limit' })
  renew(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.library.renew(this.school(schoolId), id);
  }

  @Get('students/:studentId/history')
  @RequireAnyPermission(PERMISSIONS.LIBRARY_VIEW, PERMISSIONS.SELF_LIBRARY_VIEW)
  @ApiOperation({ summary: 'Borrowing history, current loans and fine balance' })
  async borrowerHistory(
    @CurrentSchool() schoolId: string | null,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertStudentAccess(user, studentId);
    return this.library.borrowerHistory(this.school(schoolId), studentId);
  }

  // --- Fines ----------------------------------------------------------------

  @Get('fines')
  @RequirePermissions(PERMISSIONS.LIBRARY_VIEW)
  @ApiOperation({ summary: 'Library fines, optionally filtered by settlement' })
  listFines(
    @CurrentSchool() schoolId: string | null,
    @Query('settled') settled?: string,
  ) {
    const filter = settled === undefined ? undefined : settled === 'true';
    return this.library.listFines(this.school(schoolId), filter);
  }

  @Post('fines/:id/settle')
  @RequirePermissions(PERMISSIONS.LIBRARY_FINE_MANAGE)
  @ResponseMessage('Fine payment recorded')
  @ApiOperation({ summary: 'Collect against a fine, in full or in part' })
  settleFine(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SettleFineDto,
  ) {
    return this.library.settleFine(this.school(schoolId), id, dto.amount);
  }

  @Post('fines/:id/waive')
  @RequirePermissions(PERMISSIONS.LIBRARY_FINE_MANAGE)
  @ResponseMessage('Fine waived')
  @ApiOperation({ summary: 'Waive a fine balance with a recorded reason' })
  waiveFine(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WaiveFineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.library.waiveFine(this.school(schoolId), id, dto, user.id);
  }

  // --- Scheduled work -------------------------------------------------------

  @Post('overdue-scan')
  @RequirePermissions(PERMISSIONS.LIBRARY_MANAGE)
  @ResponseMessage('Overdue loans reviewed')
  @ApiOperation({ summary: 'Flag overdue loans and remind borrowers' })
  scanOverdue(@CurrentSchool() schoolId: string | null) {
    return this.library.scanOverdue(this.school(schoolId));
  }

  // --------------------------------------------------------------------------

  private async assertStudentAccess(user: AuthenticatedUser, studentId: string): Promise<void> {
    if (user.isSuperAdmin || user.permissions.includes(PERMISSIONS.LIBRARY_VIEW)) return;
    if (user.studentId === studentId) return;
    if (user.guardianId) {
      await this.guardians.assertChildAccess(user.guardianId, studentId);
      return;
    }
    throw new ForbiddenError('You do not have access to this student');
  }

  private school(schoolId: string | null): string {
    if (!schoolId) {
      throw new ForbiddenError(
        'Select a school first. Super administrators must pass the X-School-Id header.',
      );
    }
    return schoolId;
  }
}
