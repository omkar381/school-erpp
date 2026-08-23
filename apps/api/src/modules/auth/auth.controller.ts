import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ClientIp, CurrentUser, Public, UserAgent } from '../../common/decorators';
import { ResponseMessage } from '../../common/interceptors/response.interceptor';
import { UnauthorizedError } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuthService } from './auth.service';
import { OtpService } from './services/otp.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDeviceDto,
  RequestOtpDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
  VerifyOtpDto,
} from './dto/auth.dto';

const REFRESH_COOKIE = 'refresh_token';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly otp: OtpService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @ResponseMessage('Signed in successfully')
  @ApiOperation({ summary: 'Sign in with email/phone and password' })
  @ApiResponse({ status: 200, description: 'Authenticated' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 403, description: 'Account locked, inactive or suspended' })
  async login(
    @Body() dto: LoginDto,
    @ClientIp() ipAddress: string,
    @UserAgent() userAgent: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(dto, { ipAddress, userAgent });
    this.setRefreshCookie(response, result.tokens.refreshToken, result.tokens.refreshExpiresIn);
    return result;
  }

  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @ResponseMessage('Verification code sent')
  @ApiOperation({ summary: 'Request a one-time code by SMS' })
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.otp.send(dto.phone, dto.purpose ?? 'LOGIN');
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @ResponseMessage('Signed in successfully')
  @ApiOperation({ summary: 'Sign in by verifying a one-time code' })
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @ClientIp() ipAddress: string,
    @UserAgent() userAgent: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.loginWithOtp(
      dto.phone,
      dto.code,
      { ipAddress, userAgent },
      dto.device,
    );
    this.setRefreshCookie(response, result.tokens.refreshToken, result.tokens.refreshExpiresIn);
    return result;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 30, ttl: 60_000 } })
  @ResponseMessage('Session refreshed')
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair' })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() request: Request,
    @ClientIp() ipAddress: string,
    @UserAgent() userAgent: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = dto.refreshToken ?? request.cookies?.[REFRESH_COOKIE];
    if (!token) {
      throw new UnauthorizedError('No refresh token supplied', ErrorCode.TOKEN_INVALID);
    }

    const result = await this.auth.refresh(token, { ipAddress, userAgent });
    this.setRefreshCookie(response, result.tokens.refreshToken, result.tokens.refreshExpiresIn);
    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ResponseMessage('Signed out successfully')
  @ApiOperation({ summary: 'End the current session' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(user.sessionId, user.id, user.schoolId);
    this.clearRefreshCookie(response);
    return { loggedOut: true };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ResponseMessage('Signed out of all other devices')
  @ApiOperation({ summary: 'End every other session for this account' })
  async logoutAll(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logoutAll(user.id, user.sessionId);
  }

  @Get('me')
  @ApiBearerAuth()
  @ResponseMessage('Profile loaded')
  @ApiOperation({ summary: 'Get the authenticated user with roles and permissions' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List active sessions for this account' })
  sessions(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.listSessions(user.id);
  }

  @Delete('sessions/:id')
  @ApiBearerAuth()
  @ResponseMessage('Session revoked')
  @ApiOperation({ summary: 'Revoke one of your active sessions' })
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) sessionId: string,
  ) {
    await this.auth.revokeSession(user.id, sessionId);
    return { revoked: true };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 5, ttl: 300_000 } })
  @ResponseMessage('If an account exists, reset instructions have been sent')
  @ApiOperation({ summary: 'Start the password reset flow' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto);
    // The same response is returned whether or not the account exists.
    return { requested: true };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 300_000 } })
  @ResponseMessage('Password reset successfully')
  @ApiOperation({ summary: 'Complete a password reset with an emailed token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto);
    return { reset: true };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ResponseMessage('Password changed successfully')
  @ApiOperation({ summary: 'Change your own password' })
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, user.sessionId, dto);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Email verified successfully')
  @ApiOperation({ summary: 'Verify an email address' })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.auth.verifyEmail(dto.token);
    return { verified: true };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Throttle({ auth: { limit: 3, ttl: 300_000 } })
  @ResponseMessage('Verification email sent')
  @ApiOperation({ summary: 'Resend the email verification link' })
  async resendVerification(
    @CurrentUser() user: AuthenticatedUser,
    @Body() _dto: ResendVerificationDto,
  ) {
    await this.auth.sendVerificationEmail(user.id);
    return { sent: true };
  }

  @Post('devices')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ResponseMessage('Device registered')
  @ApiOperation({ summary: 'Register or update this device for push notifications' })
  async registerDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDeviceDto,
  ) {
    const deviceId = await this.auth.upsertDevice(user.id, dto);
    return { deviceId };
  }

  @Delete('devices/:token')
  @ApiBearerAuth()
  @ResponseMessage('Device unregistered')
  @ApiOperation({ summary: 'Stop sending push notifications to this device' })
  async unregisterDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('token') token: string,
  ) {
    await this.auth.removeDevice(user.id, token);
    return { removed: true };
  }

  // ---------------------------------------------------------------------------

  private setRefreshCookie(response: Response, token: string, maxAgeSeconds: number): void {
    response.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.config.get<boolean>('auth.cookieSecure', false),
      sameSite: 'lax',
      domain: this.config.get<string>('auth.cookieDomain'),
      path: '/',
      maxAge: maxAgeSeconds * 1000,
    });
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: this.config.get<boolean>('auth.cookieSecure', false),
      sameSite: 'lax',
      domain: this.config.get<string>('auth.cookieDomain'),
      path: '/',
    });
  }
}
