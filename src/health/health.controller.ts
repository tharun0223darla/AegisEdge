import { Controller, Get } from '@nestjs/common';
import { statfs } from 'fs/promises';
import {
  HealthCheck,
  HealthCheckError,
  HealthCheckService,
  type HealthIndicatorResult,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { PrismaHealthIndicator } from './indicators/prisma.health';

@ApiTags('Health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  private readonly bootTime = Date.now();

  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly prismaHealth: PrismaHealthIndicator,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Full health check (db + memory + disk)' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 503, description: 'One or more dependencies are unhealthy' })
  check() {
    return this.health.check([
      () => this.prismaHealth.isHealthy('database'),
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 500 * 1024 * 1024),
      () => this.checkDiskStorage('disk'),
    ]);
  }

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe (process is alive)' })
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe (dependencies reachable)' })
  readiness() {
    return this.health.check([() => this.prismaHealth.isHealthy('database')]);
  }

  @Public()
  @Get('uptime')
  @ApiOperation({ summary: 'Process uptime and runtime metadata' })
  uptime() {
    const uptimeMs = Date.now() - this.bootTime;
    return {
      status: 'ok',
      app: 'MediTrack AI API',
      env: process.env.NODE_ENV ?? 'development',
      nodeVersion: process.version,
      pid: process.pid,
      bootTime: new Date(this.bootTime).toISOString(),
      uptimeMs,
      uptimeHuman: this.formatUptime(uptimeMs),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDiskStorage(key: string): Promise<HealthIndicatorResult> {
    const path = process.platform === 'win32' ? 'C:\\' : '/';

    try {
      const stats = await statfs(path);
      const totalBytes = Number(stats.blocks) * Number(stats.bsize);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      const freeRatio = totalBytes > 0 ? freeBytes / totalBytes : 1;
      const result = {
        [key]: {
          status: freeRatio >= 0.1 ? 'up' : 'down',
          path,
          totalBytes,
          freeBytes,
          freePercent: Number((freeRatio * 100).toFixed(2)),
        },
      } as HealthIndicatorResult;

      if (freeRatio < 0.1) {
        throw new HealthCheckError('Disk storage is below the 10% free-space threshold', result);
      }

      return result;
    } catch (error) {
      if (error instanceof HealthCheckError) {
        throw error;
      }

      return {
        [key]: {
          status: 'up',
          path,
          skipped: true,
          reason: `Disk stats unavailable: ${(error as Error).message}`,
        },
      } as HealthIndicatorResult;
    }
  }

  private formatUptime(ms: number): string {
    const sec = Math.floor(ms / 1000) % 60;
    const min = Math.floor(ms / 60_000) % 60;
    const hr = Math.floor(ms / 3_600_000) % 24;
    const day = Math.floor(ms / 86_400_000);
    return `${day}d ${hr}h ${min}m ${sec}s`;
  }
}