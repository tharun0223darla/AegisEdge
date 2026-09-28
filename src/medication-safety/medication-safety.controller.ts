import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/userrole.enum';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  AcknowledgeSafetyFindingDto,
  CreateAllergyDto,
  UpdateAllergyDto,
  UpdateSafetyProfileDto,
} from './dto/medication-safety.dto';
import { MedicationSafetyService } from './medication-safety.service';

@ApiTags('Medication safety')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PATIENT)
@Controller('medication-safety')
export class MedicationSafetyController {
  constructor(private readonly safety: MedicationSafetyService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Reconcile my active medicines and safety findings',
  })
  overview(@CurrentUser() user: CurrentUserPayload, @Req() request: Request) {
    return this.safety.getOverview(user.sub, this.auditContext(request));
  }

  @Post('reconcile')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Run the deterministic medication safety evaluator',
  })
  reconcile(@CurrentUser() user: CurrentUserPayload, @Req() request: Request) {
    return this.safety.reconcile(user.sub, this.auditContext(request));
  }

  @Get('profile')
  getProfile(@CurrentUser() user: CurrentUserPayload) {
    return this.safety.getProfile(user.sub);
  }

  @Patch('profile')
  updateProfile(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateSafetyProfileDto,
    @Req() request: Request,
  ) {
    return this.safety.updateProfile(user.sub, dto, this.auditContext(request));
  }

  @Get('allergies')
  listAllergies(@CurrentUser() user: CurrentUserPayload) {
    return this.safety.listAllergies(user.sub);
  }

  @Post('allergies')
  createAllergy(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateAllergyDto,
    @Req() request: Request,
  ) {
    return this.safety.createAllergy(user.sub, dto, this.auditContext(request));
  }

  @Patch('allergies/:id')
  updateAllergy(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAllergyDto,
    @Req() request: Request,
  ) {
    return this.safety.updateAllergy(
      user.sub,
      id,
      dto,
      this.auditContext(request),
    );
  }

  @Delete('allergies/:id')
  removeAllergy(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    return this.safety.removeAllergy(user.sub, id, this.auditContext(request));
  }

  @Patch('findings/:id/acknowledge')
  acknowledge(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: AcknowledgeSafetyFindingDto,
    @Req() request: Request,
  ) {
    return this.safety.acknowledgeFinding(
      user.sub,
      id,
      dto,
      this.auditContext(request),
    );
  }

  @Get('care/patients/:patientId/overview')
  @ApiOperation({
    summary: 'Read safety findings explicitly shared by a patient',
  })
  caregiverOverview(
    @CurrentUser() user: CurrentUserPayload,
    @Param('patientId') patientId: string,
    @Req() request: Request,
  ) {
    return this.safety.getCaregiverOverview(
      user.sub,
      patientId,
      this.auditContext(request),
    );
  }

  private auditContext(request: Request) {
    return {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    };
  }
}
