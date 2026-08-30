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
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DocumentOwnerType } from '@prisma/client';
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
import { ResponseMessage, SkipEnvelope } from '../../common/interceptors/response.interceptor';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { DocumentsService } from './documents.service';
import {
  CreateCategoryDto,
  DocumentQueryDto,
  UpdateDocumentDto,
  UploadDocumentDto,
  VerifyDocumentDto,
} from './dto/documents.dto';

/** Matches the platform-wide upload ceiling for attachments. */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

@ApiTags('Documents')
@ApiBearerAuth()
@ApiSchoolHeader()
@RequireModule(MODULES.DOCUMENTS)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('statistics')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  @ApiOperation({ summary: 'Counts, verification backlog and storage used' })
  statistics(@CurrentSchool() schoolId: string | null) {
    return this.documents.statistics(this.school(schoolId));
  }

  // --- Categories -----------------------------------------------------------

  @Get('categories')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  @ApiQuery({ name: 'ownerType', enum: DocumentOwnerType, required: false })
  @ApiOperation({ summary: 'Document categories available to this school' })
  listCategories(
    @CurrentSchool() schoolId: string | null,
    @Query('ownerType') ownerType?: DocumentOwnerType,
  ) {
    return this.documents.listCategories(this.school(schoolId), ownerType);
  }

  @Post('categories')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_UPLOAD)
  @ResponseMessage('Category created')
  @ApiOperation({ summary: 'Add a document category' })
  createCategory(@CurrentSchool() schoolId: string | null, @Body() dto: CreateCategoryDto) {
    return this.documents.createCategory(this.school(schoolId), dto);
  }

  @Delete('categories/:id')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_DELETE)
  @ResponseMessage('Category deleted')
  @ApiOperation({ summary: 'Delete an empty document category' })
  deleteCategory(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.deleteCategory(this.school(schoolId), id);
  }

  // --- Documents ------------------------------------------------------------

  @Get()
  @RequireAnyPermission(PERMISSIONS.DOCUMENTS_VIEW, PERMISSIONS.SELF_DOCUMENTS_VIEW)
  @ApiOperation({ summary: 'Search stored documents' })
  list(@CurrentSchool() schoolId: string | null, @Query() query: DocumentQueryDto) {
    return this.documents.list(this.school(schoolId), query);
  }

  @Get('missing')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  @ApiQuery({ name: 'ownerType', enum: DocumentOwnerType })
  @ApiOperation({ summary: 'Required categories this person has not supplied' })
  missing(
    @CurrentSchool() schoolId: string | null,
    @Query('ownerType') ownerType: DocumentOwnerType,
    @Query('ownerId', ParseUUIDPipe) ownerId: string,
  ) {
    return this.documents.missingRequired(this.school(schoolId), ownerType, ownerId);
  }

  @Get(':id')
  @RequireAnyPermission(PERMISSIONS.DOCUMENTS_VIEW, PERMISSIONS.SELF_DOCUMENTS_VIEW)
  @ApiOperation({ summary: 'Document detail' })
  findOne(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.findOne(this.school(schoolId), id);
  }

  @Get(':id/download')
  @RequireAnyPermission(PERMISSIONS.DOCUMENTS_VIEW, PERMISSIONS.SELF_DOCUMENTS_VIEW)
  @SkipEnvelope()
  @ApiOperation({ summary: 'Stream the stored file' })
  async download(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ) {
    const file = await this.documents.readFile(this.school(schoolId), id, user.id);

    response
      .status(200)
      .set({
        'Content-Type': file.mimeType,
        'Content-Length': String(file.buffer.length),
        'Content-Disposition': `attachment; filename="${file.fileName}"`,
        // Personal documents must never be held by a shared cache.
        'Cache-Control': 'private, no-store',
      })
      .end(file.buffer);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.DOCUMENTS_UPLOAD)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'ownerType', 'title'],
      properties: {
        file: { type: 'string', format: 'binary' },
        ownerType: { type: 'string', enum: Object.values(DocumentOwnerType) },
        categoryId: { type: 'string', format: 'uuid' },
        studentId: { type: 'string', format: 'uuid' },
        staffId: { type: 'string', format: 'uuid' },
        guardianId: { type: 'string', format: 'uuid' },
        title: { type: 'string' },
        description: { type: 'string' },
        issueDate: { type: 'string', format: 'date' },
        expiryDate: { type: 'string', format: 'date' },
        isPublic: { type: 'boolean' },
      },
    },
  })
  @ResponseMessage('Document uploaded')
  @ApiOperation({ summary: 'Upload and file a document against a student, staff member or guardian' })
  upload(
    @CurrentSchool() schoolId: string | null,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.upload(this.school(schoolId), file, dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_UPLOAD)
  @ResponseMessage('Document updated')
  @ApiOperation({ summary: 'Edit a document’s title, category or dates' })
  update(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.update(this.school(schoolId), id, dto, user.id);
  }

  @Patch(':id/verify')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_UPLOAD)
  @ResponseMessage('Document updated')
  @ApiOperation({ summary: 'Mark a document as checked, or send it back' })
  verify(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.verify(this.school(schoolId), id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_DELETE)
  @ResponseMessage('Document deleted')
  @ApiOperation({ summary: 'Remove a document from the register' })
  remove(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.remove(this.school(schoolId), id, user.id);
  }

  private school(schoolId: string | null): string {
    if (!schoolId) {
      throw new ForbiddenError('Select a school before working with documents.');
    }
    return schoolId;
  }
}
