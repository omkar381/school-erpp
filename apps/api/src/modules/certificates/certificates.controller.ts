import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CertificateType } from '@prisma/client';
import {
  ApiSchoolHeader,
  CurrentSchool,
  CurrentUser,
  RequirePermissions,
} from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { CertificatesService } from './certificates.service';
import {
  BulkIssueCertificateDto,
  CertificateQueryDto,
  CreateTemplateDto,
  IdCardQueryDto,
  IssueCertificateDto,
  IssueIdCardDto,
  RevokeCertificateDto,
  UpdateTemplateDto,
} from './dto/certificates.dto';

/**
 * Issuance and revocation. Rendering the printable file is the PDF module's
 * job: `GET /pdf/certificates/:id` and `POST /pdf/id-cards/...` stream them.
 *
 * The module gate is applied per route rather than on the controller, because
 * certificates and ID cards are separately licensable features.
 */
@ApiTags('Certificates')
@ApiBearerAuth()
@ApiSchoolHeader()
@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get('statistics')
  @RequirePermissions(PERMISSIONS.CERTIFICATES_GENERATE)
  @ApiOperation({ summary: 'Issued counts by type, revocations and live ID cards' })
  statistics(@CurrentSchool() schoolId: string | null) {
    return this.certificates.statistics(this.school(schoolId));
  }

  // --- Templates ------------------------------------------------------------

  @Get('templates')
  @RequirePermissions(PERMISSIONS.CERTIFICATES_GENERATE)
  @ApiQuery({ name: 'type', enum: CertificateType, required: false })
  @ApiOperation({ summary: "The school's templates plus the shared platform ones" })
  listTemplates(@CurrentSchool() schoolId: string | null, @Query('type') type?: CertificateType) {
    return this.certificates.listTemplates(this.school(schoolId), type);
  }

  @Post('templates')
  @RequirePermissions(PERMISSIONS.CERTIFICATES_GENERATE)
  @ResponseMessage('Template created')
  @ApiOperation({ summary: 'Create a certificate template' })
  createTemplate(@CurrentSchool() schoolId: string | null, @Body() dto: CreateTemplateDto) {
    return this.certificates.createTemplate(this.school(schoolId), dto);
  }

  @Patch('templates/:id')
  @RequirePermissions(PERMISSIONS.CERTIFICATES_GENERATE)
  @ResponseMessage('Template updated')
  @ApiOperation({ summary: 'Edit or deactivate a certificate template' })
  updateTemplate(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.certificates.updateTemplate(this.school(schoolId), id, dto);
  }

  @Delete('templates/:id')
  @RequirePermissions(PERMISSIONS.CERTIFICATES_GENERATE)
  @ResponseMessage('Template deleted')
  @ApiOperation({ summary: 'Delete a template that has never been used' })
  deleteTemplate(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.certificates.deleteTemplate(this.school(schoolId), id);
  }

  // --- Certificates ---------------------------------------------------------

  @Get()
  @RequirePermissions(PERMISSIONS.CERTIFICATES_GENERATE)
  @ApiOperation({ summary: 'The issue register' })
  list(@CurrentSchool() schoolId: string | null, @Query() query: CertificateQueryDto) {
    return this.certificates.list(this.school(schoolId), query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CERTIFICATES_GENERATE)
  @ApiOperation({ summary: 'A single certificate with the values it was rendered from' })
  findOne(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.certificates.findOne(this.school(schoolId), id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CERTIFICATES_GENERATE)
  @ResponseMessage('Certificate issued')
  @ApiOperation({ summary: 'Issue a certificate to a student or staff member' })
  issue(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: IssueCertificateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.certificates.issue(this.school(schoolId), dto, user.id);
  }

  @Post('bulk')
  @RequirePermissions(PERMISSIONS.CERTIFICATES_GENERATE)
  @ResponseMessage('Certificates issued')
  @ApiOperation({ summary: 'Issue the same certificate to a list of students' })
  bulkIssue(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: BulkIssueCertificateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.certificates.bulkIssue(this.school(schoolId), dto, user.id);
  }

  @Patch(':id/revoke')
  @RequirePermissions(PERMISSIONS.CERTIFICATES_GENERATE)
  @ResponseMessage('Certificate revoked')
  @ApiOperation({ summary: 'Revoke an issued certificate, keeping it on the register' })
  revoke(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokeCertificateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.certificates.revoke(this.school(schoolId), id, dto, user.id);
  }

  // --- ID cards -------------------------------------------------------------

  @Get('id-cards/list')
  @RequirePermissions(PERMISSIONS.ID_CARDS_GENERATE)
  @ApiOperation({ summary: 'Issued identity cards' })
  listIdCards(@CurrentSchool() schoolId: string | null, @Query() query: IdCardQueryDto) {
    return this.certificates.listIdCards(this.school(schoolId), query);
  }

  @Post('id-cards')
  @RequirePermissions(PERMISSIONS.ID_CARDS_GENERATE)
  @ResponseMessage('ID card issued')
  @ApiOperation({ summary: 'Issue a card, deactivating any the holder already has' })
  issueIdCard(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: IssueIdCardDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.certificates.issueIdCard(this.school(schoolId), dto, user.id);
  }

  @Patch('id-cards/:id/deactivate')
  @RequirePermissions(PERMISSIONS.ID_CARDS_GENERATE)
  @ResponseMessage('ID card deactivated')
  @ApiOperation({ summary: 'Deactivate a lost or superseded card' })
  deactivateIdCard(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.certificates.deactivateIdCard(this.school(schoolId), id, user.id);
  }

  private school(schoolId: string | null): string {
    if (!schoolId) {
      throw new ForbiddenError('Select a school before issuing documents.');
    }
    return schoolId;
  }
}
