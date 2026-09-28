import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { EmergencyService } from './emergency.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { NearbyHospitalsDto } from './dto/nearby-hospitals.dto';
import {
  EmergencySosDto,
  RequestAmbulanceDto,
  UpdateAmbulanceLocationDto,
} from './dto/ambulance-request.dto';

@ApiTags('Emergency & Hospitals')
@Controller('emergency')
export class EmergencyController {
  constructor(private readonly emergencyService: EmergencyService) {}

  // ── GET /api/emergency/hospitals/nearby ─────────────────────
  @Public()
  @Get('hospitals/nearby')
  @ApiOperation({
    summary: 'Find nearby hospitals, emergency centers, clinics, and pharmacies',
    description:
      'Queries OpenStreetMap / Overpass with automatic fallback endpoints and resilient regional directory.',
  })
  async getNearbyHospitals(@Query() query: NearbyHospitalsDto) {
    return this.emergencyService.getNearbyHospitals(query);
  }

  // ── POST /api/emergency/ambulance/request ───────────────────
  @Public()
  @Post('ambulance/request')
  @ApiOperation({
    summary: 'Request and dispatch an emergency ambulance',
    description:
      'Creates a live ambulance tracking session, assigns vehicle & paramedic driver, and returns request ID.',
  })
  async requestAmbulance(
    @Body() dto: RequestAmbulanceDto,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    return this.emergencyService.requestAmbulance(user?.sub, dto);
  }

  // ── GET /api/emergency/ambulance/:requestId ─────────────────
  @Public()
  @Get('ambulance/:requestId')
  @ApiOperation({
    summary: 'Get live ambulance tracking telemetry and status',
    description:
      'Returns real-time vehicle GPS coordinates, driver details, speed, ETA, and journey status.',
  })
  getAmbulanceStatus(@Param('requestId') requestId: string) {
    return this.emergencyService.getAmbulanceStatus(requestId);
  }

  // ── POST /api/emergency/ambulance/:requestId/location ───────
  @Public()
  @Post('ambulance/:requestId/location')
  @ApiOperation({ summary: 'Update live GPS coordinates for an ambulance' })
  updateAmbulanceLocation(
    @Param('requestId') requestId: string,
    @Body() dto: UpdateAmbulanceLocationDto,
  ) {
    return this.emergencyService.updateAmbulanceLocation(requestId, dto);
  }

  // ── POST /api/emergency/ambulance/:requestId/cancel ─────────
  @Public()
  @Post('ambulance/:requestId/cancel')
  @ApiOperation({ summary: 'Cancel an active ambulance request' })
  cancelAmbulance(@Param('requestId') requestId: string) {
    return this.emergencyService.cancelAmbulance(requestId);
  }

  // ── POST /api/emergency/sos ─────────────────────────────────
  @Public()
  @Post('sos')
  @ApiOperation({
    summary: 'One-touch Emergency SOS trigger',
    description: 'Dispatches high-priority ambulance and alerts care circle contacts.',
  })
  async triggerSos(
    @Body() dto: EmergencySosDto,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    return this.emergencyService.triggerSos(user?.sub, dto);
  }
}
