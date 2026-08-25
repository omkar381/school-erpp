import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiSchoolHeader,
  CurrentSchool,
  CurrentUser,
  Public,
  RequirePermissions,
} from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { ForbiddenError } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { WebsiteService } from './website.service';
import {
  PublicEnquiryDto,
  UpsertGalleryAlbumDto,
  UpsertWebsitePageDto,
} from './dto/website.dto';

/**
 * The public face of a school.
 *
 * Everything under `/public` is unauthenticated and reachable by the whole
 * internet, so each endpoint returns a deliberately narrow projection — the
 * sort of thing already printed in a prospectus, never internal figures.
 */
@ApiTags('Website')
@Controller('website')
export class WebsiteController {
  constructor(private readonly website: WebsiteService) {}

  // --- Public ---------------------------------------------------------------

  @Public()
  @Get('public/:slug')
  @ApiOperation({ summary: 'School identity, branding and menu for the public site' })
  publicSchool(@Param('slug') slug: string) {
    return this.website.publicSchool(slug);
  }

  @Public()
  @Get('public/:slug/statistics')
  @ApiOperation({ summary: 'Headline figures for the public site' })
  publicStatistics(@Param('slug') slug: string) {
    return this.website.publicStatistics(slug);
  }

  @Public()
  @Get('public/:slug/faculty')
  @ApiOperation({ summary: 'Teaching staff, without personal contact details' })
  publicFaculty(@Param('slug') slug: string) {
    return this.website.publicFaculty(slug);
  }

  @Public()
  @Get('public/:slug/notices')
  @ApiOperation({ summary: 'Published notices with a public audience' })
  publicNotices(@Param('slug') slug: string, @Query('limit') limit?: string) {
    return this.website.publicNotices(slug, limit ? Number(limit) : 10);
  }

  @Public()
  @Get('public/:slug/gallery')
  @ApiOperation({ summary: 'Published photo albums' })
  publicGallery(@Param('slug') slug: string) {
    return this.website.publicGallery(slug);
  }

  @Public()
  @Get('public/:slug/gallery/:albumSlug')
  @ApiOperation({ summary: 'One album with its photos' })
  publicAlbum(@Param('slug') slug: string, @Param('albumSlug') albumSlug: string) {
    return this.website.publicAlbum(slug, albumSlug);
  }

  @Public()
  @Get('public/:slug/sitemap')
  @ApiOperation({ summary: 'Published page and album slugs for the sitemap' })
  sitemap(@Param('slug') slug: string) {
    return this.website.sitemap(slug);
  }

  @Public()
  @Get('public/:slug/pages/:pageSlug')
  @ApiOperation({ summary: 'One published content page' })
  publicPage(@Param('slug') slug: string, @Param('pageSlug') pageSlug: string) {
    return this.website.publicPage(slug, pageSlug);
  }

  /**
   * Admission enquiries are the one thing the public can write, so the rate
   * limit here is far tighter than the platform default.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Post('public/:slug/enquiries')
  @ResponseMessage('Thank you — the school will be in touch shortly')
  @ApiOperation({ summary: 'Submit an admission enquiry from the website' })
  submitEnquiry(
    @Param('slug') slug: string,
    @Body() dto: PublicEnquiryDto,
    @Ip() ip: string,
  ) {
    return this.website.submitEnquiry(slug, dto, ip);
  }

  // --- Administration -------------------------------------------------------

  @Get('pages')
  @ApiBearerAuth()
  @ApiSchoolHeader()
  @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  @ApiOperation({ summary: 'Every content page, published or draft' })
  listPages(@CurrentSchool() schoolId: string | null) {
    return this.website.listPages(this.school(schoolId));
  }

  @Get('pages/:id')
  @ApiBearerAuth()
  @ApiSchoolHeader()
  @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  @ApiOperation({ summary: 'One page with its content blocks' })
  getPage(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.website.getPage(this.school(schoolId), id);
  }

  @Put('pages')
  @ApiBearerAuth()
  @ApiSchoolHeader()
  @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  @ResponseMessage('Page saved')
  @ApiOperation({ summary: 'Create or replace a content page by its slug' })
  upsertPage(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: UpsertWebsitePageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.website.upsertPage(this.school(schoolId), dto, user.id);
  }

  @Post('pages/seed')
  @ApiBearerAuth()
  @ApiSchoolHeader()
  @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  @ResponseMessage('Starter pages created')
  @ApiOperation({ summary: 'Create the standard pages as drafts to edit' })
  seedPages(
    @CurrentSchool() schoolId: string | null,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.website.seedCorePages(this.school(schoolId), user.id);
  }

  @Delete('pages/:id')
  @ApiBearerAuth()
  @ApiSchoolHeader()
  @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  @ResponseMessage('Page deleted')
  @ApiOperation({ summary: 'Delete a content page' })
  deletePage(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.website.deletePage(this.school(schoolId), id);
  }

  @Get('albums')
  @ApiBearerAuth()
  @ApiSchoolHeader()
  @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  @ApiOperation({ summary: 'Every gallery album, published or draft' })
  listAlbums(@CurrentSchool() schoolId: string | null) {
    return this.website.listAlbums(this.school(schoolId));
  }

  @Post('albums')
  @ApiBearerAuth()
  @ApiSchoolHeader()
  @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  @ResponseMessage('Album created')
  @ApiOperation({ summary: 'Create a gallery album with its photos' })
  createAlbum(
    @CurrentSchool() schoolId: string | null,
    @Body() dto: UpsertGalleryAlbumDto,
  ) {
    return this.website.upsertAlbum(this.school(schoolId), dto);
  }

  @Put('albums/:id')
  @ApiBearerAuth()
  @ApiSchoolHeader()
  @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  @ResponseMessage('Album updated')
  @ApiOperation({ summary: 'Update an album; the photo list replaces the existing one' })
  updateAlbum(
    @CurrentSchool() schoolId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertGalleryAlbumDto,
  ) {
    return this.website.upsertAlbum(this.school(schoolId), dto, id);
  }

  @Delete('albums/:id')
  @ApiBearerAuth()
  @ApiSchoolHeader()
  @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  @ResponseMessage('Album deleted')
  @ApiOperation({ summary: 'Delete a gallery album and its photos' })
  deleteAlbum(@CurrentSchool() schoolId: string | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.website.deleteAlbum(this.school(schoolId), id);
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
