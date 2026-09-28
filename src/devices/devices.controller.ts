import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { SyncReadingDto } from './dto/sync-reading.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/userrole.enum';

@ApiTags('Bluetooth Devices')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'Register/pair a new Bluetooth device' })
  registerDevice(@CurrentUser() user: CurrentUserPayload, @Body() dto: RegisterDeviceDto) {
    return this.devicesService.registerDevice(user.sub, dto);
  }

  @Get()
  @Roles(UserRole.PATIENT, UserRole.CAREGIVER)
  @ApiOperation({ summary: 'Get all paired devices for the user' })
  getDevices(@CurrentUser() user: CurrentUserPayload) {
    return this.devicesService.getDevices(user.sub);
  }

  @Delete(':deviceId')
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'Unpair a Bluetooth device' })
  unregisterDevice(@CurrentUser() user: CurrentUserPayload, @Param('deviceId') deviceId: string) {
    return this.devicesService.unregisterDevice(user.sub, deviceId);
  }

  @Post(':deviceId/sync')
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'Sync readings or events from a paired Bluetooth device' })
  syncReading(
    @CurrentUser() user: CurrentUserPayload,
    @Param('deviceId') deviceId: string,
    @Body() dto: SyncReadingDto,
  ) {
    return this.devicesService.syncReading(user.sub, deviceId, dto);
  }
}
