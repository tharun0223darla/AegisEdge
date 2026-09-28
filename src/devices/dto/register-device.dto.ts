import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DeviceType } from '@prisma/client';

export class RegisterDeviceDto {
  @ApiProperty({ description: 'Name of the device', example: "Tharun's BP Monitor" })
  @IsString()
  @IsNotEmpty()
  deviceName: string;

  @ApiProperty({ description: 'Bluetooth UUID or MAC address of the device', example: '00:11:22:33:AA:BB' })
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @ApiProperty({ enum: DeviceType, example: 'BP_METER' })
  @IsEnum(DeviceType)
  @IsNotEmpty()
  deviceType: DeviceType;
}
