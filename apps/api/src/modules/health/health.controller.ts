import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { SkipEnvelope } from '../../common/interceptors/response.interceptor';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @SkipEnvelope()
  @ApiOperation({ summary: 'Full health report including dependencies' })
  check() {
    return this.health.check();
  }

  @Public()
  @Get('live')
  @SkipEnvelope()
  @ApiExcludeEndpoint()
  live() {
    // Liveness must not touch dependencies: it only answers "is the process up".
    return { status: 'ok', uptime: Math.floor(process.uptime()) };
  }

  @Public()
  @Get('ready')
  @SkipEnvelope()
  @ApiExcludeEndpoint()
  ready() {
    return this.health.readiness();
  }
}
