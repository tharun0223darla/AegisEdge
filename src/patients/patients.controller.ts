import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  UseGuards,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PatientsService } from './patients.service';
import { CreatePatientProfileDto } from './dto/create-patient-profile.dto';
import { UpdatePatientProfileDto } from './dto/update-patient-profile.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/userrole.enum';

@ApiTags('Patients')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post('profile')
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'Create patient profile (patient only)' })
  createProfile(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreatePatientProfileDto,
  ) {
    return this.patientsService.createProfile(user.sub, dto);
  }

  @Get('profile/me')
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'Get my patient profile' })
  getMyProfile(@CurrentUser() user: CurrentUserPayload) {
    return this.patientsService.getMyProfile(user.sub);
  }

  @Patch('profile/me')
  @Roles(UserRole.PATIENT)
  @ApiOperation({ summary: 'Update my patient profile' })
  updateProfile(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdatePatientProfileDto,
  ) {
    return this.patientsService.updateProfile(user.sub, dto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '[ADMIN/DOCTOR] List all patient profiles' })
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.patientsService.findAll(page, Math.min(limit, 100));
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '[ADMIN/DOCTOR] Get patient profile by id' })
  getProfile(@Param('id') id: string) {
    return this.patientsService.getProfileById(id);
  }
}
