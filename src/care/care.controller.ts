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
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/userrole.enum';
import { CareService } from './care.service';
import { CareEscalationService } from './care-escalation.service';
import {
  AcceptCareInvitationDto,
  CareInvitationTokenDto,
  CreateCareInvitationDto,
  UpdateCarePermissionsDto,
} from './dto/care.dto';

@ApiTags('Care circle')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PATIENT, UserRole.CAREGIVER)
@Controller('care')
export class CareController {
  constructor(
    private readonly careService: CareService,
    private readonly careEscalations: CareEscalationService,
  ) {}

  @Post('doses/:doseLogId/help')
  @Roles(UserRole.PATIENT)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Request a privacy-safe caregiver check-in for a dose',
  })
  requestDoseHelp(
    @CurrentUser() user: CurrentUserPayload,
    @Param('doseLogId') doseLogId: string,
  ) {
    return this.careEscalations.requestDoseHelp(user.sub, doseLogId);
  }

  @Post('invitations')
  @Roles(UserRole.PATIENT)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a time-limited caregiver invitation' })
  createInvitation(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateCareInvitationDto,
    @Req() request: Request,
  ) {
    return this.careService.createInvitation(
      user.sub,
      dto,
      this.auditContext(request),
    );
  }

  @Get('invitations')
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'List people with access and pending invitations' })
  listInvitations(@CurrentUser() user: CurrentUserPayload) {
    return this.careService.listForPatient(user.sub);
  }

  @Post('invitations/preview')
  @Roles(UserRole.CAREGIVER)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Preview an invitation without accepting it' })
  previewInvitation(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CareInvitationTokenDto,
  ) {
    return this.careService.previewInvitation(user.sub, dto.token);
  }

  @Post('invitations/accept')
  @Roles(UserRole.CAREGIVER)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Accept caregiver responsibilities and access' })
  acceptInvitation(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: AcceptCareInvitationDto,
    @Req() request: Request,
  ) {
    return this.careService.acceptInvitation(
      user.sub,
      dto,
      this.auditContext(request),
    );
  }

  @Delete('invitations/:id')
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'Revoke a pending caregiver invitation' })
  revokeInvitation(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') invitationId: string,
    @Req() request: Request,
  ) {
    return this.careService.revokeInvitation(
      user.sub,
      invitationId,
      this.auditContext(request),
    );
  }

  @Get('relationships/as-caregiver')
  @Roles(UserRole.CAREGIVER)
  @ApiOperation({ summary: 'List patients who shared access with me' })
  listAsCaregiver(@CurrentUser() user: CurrentUserPayload) {
    return this.careService.listForCaregiver(user.sub);
  }

  @Patch('relationships/:id')
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'Change caregiver permissions' })
  updatePermissions(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') relationshipId: string,
    @Body() dto: UpdateCarePermissionsDto,
    @Req() request: Request,
  ) {
    return this.careService.updatePermissions(
      user.sub,
      relationshipId,
      dto,
      this.auditContext(request),
    );
  }

  @Delete('relationships/:id')
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'Immediately revoke caregiver access' })
  revokeRelationship(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') relationshipId: string,
    @Req() request: Request,
  ) {
    return this.careService.revokeRelationship(
      user.sub,
      relationshipId,
      this.auditContext(request),
    );
  }

  @Get('access-log')
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'Show recent caregiver dashboard access' })
  getAccessLog(@CurrentUser() user: CurrentUserPayload) {
    return this.careService.getPatientAccessLog(user.sub);
  }

  @Get('patients/:patientId/dashboard')
  @Roles(UserRole.CAREGIVER)
  @ApiOperation({
    summary: 'Get only the patient data explicitly shared with me',
  })
  getCaregiverDashboard(
    @CurrentUser() user: CurrentUserPayload,
    @Param('patientId') patientId: string,
    @Req() request: Request,
  ) {
    return this.careService.getCaregiverDashboard(
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
