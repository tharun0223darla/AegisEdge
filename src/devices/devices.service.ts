import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HealthMetricsService } from '../health-metrics/health-metrics.service';
import type { HealthDeviceRecord } from '../health-metrics/health-metric.types';
import { DoseLogsService } from '../dose-logs/dose-logs.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { SyncReadingDto } from './dto/sync-reading.dto';
import { DoseStatus } from '@prisma/client';
import { DoseActionStatus } from '../dose-logs/dto/create-dose-log.dto';

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    private prisma: PrismaService,
    private healthMetricsService: HealthMetricsService,
    private doseLogsService: DoseLogsService,
  ) {}

  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    return this.prisma.deviceRegistry.upsert({
      where: {
        userId_deviceId: {
          userId,
          deviceId: dto.deviceId,
        },
      },
      update: {
        deviceName: dto.deviceName,
        deviceType: dto.deviceType,
        isPaired: true,
      },
      create: {
        userId,
        deviceId: dto.deviceId,
        deviceName: dto.deviceName,
        deviceType: dto.deviceType,
        trustLevel: dto.deviceId.startsWith('sim-')
          ? 'SIMULATOR'
          : 'UNVERIFIED',
        isPaired: true,
      },
    });
  }

  async getDevices(userId: string) {
    return this.prisma.deviceRegistry.findMany({
      where: { userId, isPaired: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async unregisterDevice(userId: string, deviceId: string) {
    const device = await this.prisma.deviceRegistry.findFirst({
      where: { userId, deviceId },
    });
    if (!device) throw new NotFoundException('Device not found.');

    return this.prisma.deviceRegistry.update({
      where: { id: device.id },
      data: { isPaired: false },
    });
  }

  async syncReading(userId: string, deviceId: string, dto: SyncReadingDto) {
    // 1. Fetch registered device
    const device = await this.prisma.deviceRegistry.findFirst({
      where: { userId, deviceId, isPaired: true },
    });
    if (!device) {
      throw new NotFoundException(
        'Device not found or not paired to this account.',
      );
    }
    const healthDevice = this.toHealthDeviceRecord(device);

    let result: unknown = null;

    // The paired registry determines provenance. A request body can never promote itself
    // from simulated or unverified data to a trusted device reading.
    switch (device.deviceType) {
      case 'BP_METER':
        result = await this.healthMetricsService.createFromDevice(
          userId,
          healthDevice,
          {
            metricType: 'BLOOD_PRESSURE',
            value: dto.value,
            recordedAt: dto.recordedAt,
            clientRecordId: dto.clientRecordId,
            unit: dto.unit,
            timezoneOffsetMinutes: dto.timezoneOffsetMinutes,
          },
        );
        break;

      case 'GLUCOSE_METER':
        result = await this.healthMetricsService.createFromDevice(
          userId,
          healthDevice,
          {
            metricType: 'BLOOD_GLUCOSE',
            value: dto.value,
            recordedAt: dto.recordedAt,
            clientRecordId: dto.clientRecordId,
            unit: dto.unit,
            timezoneOffsetMinutes: dto.timezoneOffsetMinutes,
          },
        );
        break;

      case 'PULSE_OXIMETER':
        result = await this.healthMetricsService.createFromDevice(
          userId,
          healthDevice,
          {
            metricType: 'OXYGEN_SATURATION',
            value: dto.value,
            recordedAt: dto.recordedAt,
            clientRecordId: dto.clientRecordId,
            unit: dto.unit,
            timezoneOffsetMinutes: dto.timezoneOffsetMinutes,
          },
        );
        break;

      case 'SMARTWATCH': {
        const readings: unknown[] = [];
        if (dto.value.heartRate !== undefined) {
          readings.push(
            await this.healthMetricsService.createFromDevice(
              userId,
              healthDevice,
              {
                metricType: 'HEART_RATE',
                value: {
                  heartRate: dto.value.heartRate,
                  context: dto.value.context ?? 'UNKNOWN',
                },
                recordedAt: dto.recordedAt,
                clientRecordId: dto.clientRecordId,
                timezoneOffsetMinutes: dto.timezoneOffsetMinutes,
              },
            ),
          );
        }
        if (
          dto.value.oxygenSaturation !== undefined ||
          dto.value.spo2 !== undefined
        ) {
          readings.push(
            await this.healthMetricsService.createFromDevice(
              userId,
              healthDevice,
              {
                metricType: 'OXYGEN_SATURATION',
                value: {
                  oxygenSaturation:
                    dto.value.oxygenSaturation ?? dto.value.spo2,
                },
                recordedAt: dto.recordedAt,
                clientRecordId: dto.clientRecordId,
                timezoneOffsetMinutes: dto.timezoneOffsetMinutes,
              },
            ),
          );
        }
        if (dto.value.sleepHours !== undefined) {
          readings.push(
            await this.healthMetricsService.createFromDevice(
              userId,
              healthDevice,
              {
                metricType: 'SLEEP_HOURS',
                value: { sleepHours: dto.value.sleepHours },
                recordedAt: dto.recordedAt,
                clientRecordId: dto.clientRecordId,
                timezoneOffsetMinutes: dto.timezoneOffsetMinutes,
              },
            ),
          );
        }
        result = readings;
        break;
      }

      case 'SMART_CAP': {
        // Smart Cap Trigger: Mark today's closest pending dose log as taken
        if (dto.value.status === 'OPEN') {
          // Query pending dose log scheduled within +/- 3 hours
          const windowStart = new Date(Date.now() - 3 * 60 * 60 * 1000);
          const windowEnd = new Date(Date.now() + 3 * 60 * 60 * 1000);

          const pendingDose = await this.prisma.doseLog.findFirst({
            where: {
              userId,
              status: DoseStatus.PENDING,
              scheduledAt: { gte: windowStart, lte: windowEnd },
            },
            orderBy: { scheduledAt: 'asc' },
          });

          if (pendingDose) {
            result = await this.doseLogsService.recordAction(userId, {
              scheduleId: pendingDose.scheduleId,
              scheduledAt: pendingDose.scheduledAt.toISOString(),
              status: DoseActionStatus.TAKEN,
              notes: `Recorded automatically via Smart Cap (${device.deviceName}).`,
            });
            this.logger.log(
              `Auto-logged dose TAKEN for scheduleId: ${pendingDose.scheduleId} via smart cap.`,
            );
          } else {
            result = {
              success: false,
              message:
                'Cap opened, but no pending dose scheduled within +/- 3 hours.',
            };
          }
        }
        break;
      }

      default:
        break;
    }

    // 3. Update sync timestamp
    await this.prisma.deviceRegistry.update({
      where: { id: device.id },
      data: { lastSyncedAt: new Date(), lastSyncError: null },
    });

    return {
      syncedAt: new Date(),
      deviceType: device.deviceType,
      deviceName: device.deviceName,
      result,
    };
  }

  private toHealthDeviceRecord(value: unknown): HealthDeviceRecord {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('id' in value) ||
      !('trustLevel' in value)
    ) {
      throw new Error('Paired device provenance is incomplete.');
    }
    const id = value.id;
    const trustLevel = value.trustLevel;
    if (
      typeof id !== 'string' ||
      (trustLevel !== 'UNVERIFIED' &&
        trustLevel !== 'SIMULATOR' &&
        trustLevel !== 'VERIFIED')
    ) {
      throw new Error('Paired device provenance is invalid.');
    }
    return { id, trustLevel };
  }
}
