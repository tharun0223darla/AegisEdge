import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VaccinationsService } from './vaccinations.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import {
  AddCustomVaccineDto,
  BookVaccineAppointmentDto,
  FindNearbyCentersDto,
  GetVaccineDirectoryDto,
  GetVaccineScheduleDto,
  RecordVaccineAdministeredDto,
  TriggerVaccineReminderDto,
  UpdateVaccineRecordDto,
} from './dto/vaccination.dto';

@ApiTags('Vaccinations & Immunization')
@Controller('vaccinations')
export class VaccinationsController {
  constructor(private readonly vaccinationsService: VaccinationsService) {}

  // ── GET /api/v1/vaccinations/directory ──────────────────────
  @Public()
  @Get('directory')
  @ApiOperation({
    summary: 'Get vaccine encyclopedia & clinical indications',
    description: 'Searchable master directory of vaccines across age milestones, dosages, routes, and UIP indicators.',
  })
  getVaccineDirectory(@Query() query: GetVaccineDirectoryDto) {
    return this.vaccinationsService.getVaccineDirectory(query);
  }

  // ── GET /api/v1/vaccinations/directory/:vaccineId ───────────
  @Public()
  @Get('directory/:vaccineId')
  @ApiOperation({ summary: 'Get in-depth clinical details for a specific vaccine' })
  getVaccineDetails(@Param('vaccineId') vaccineId: string) {
    return this.vaccinationsService.getVaccineDetailsById(vaccineId);
  }

  // ── GET /api/v1/vaccinations/schedule ───────────────────────
  @Public()
  @Get('schedule')
  @ApiOperation({
    summary: 'Get personalized family vaccination schedule & immunization passport',
    description: 'Returns scheduled and recorded vaccines for the authenticated user and family members.',
  })
  getSchedule(
    @Query() query: GetVaccineScheduleDto,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    const userId = user?.sub || 'default-user';
    return this.vaccinationsService.getVaccinationSchedule(userId, query);
  }

  // ── POST /api/v1/vaccinations/record ────────────────────────
  @Public()
  @Post('record')
  @ApiOperation({
    summary: 'Record an administered vaccine dose',
    description: 'Logs administered date, batch number, clinic name, administering doctor, and adverse notes.',
  })
  recordVaccine(
    @Body() dto: RecordVaccineAdministeredDto,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    const userId = user?.sub || 'default-user';
    return this.vaccinationsService.recordVaccineAdministered(userId, dto);
  }

  // ── PUT /api/v1/vaccinations/record/:recordId ───────────────
  @Public()
  @Put('record/:recordId')
  @ApiOperation({ summary: 'Update vaccination record details or status' })
  updateRecord(
    @Param('recordId') recordId: string,
    @Body() dto: UpdateVaccineRecordDto,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    const userId = user?.sub || 'default-user';
    return this.vaccinationsService.updateVaccineRecord(userId, recordId, dto);
  }

  // ── POST /api/v1/vaccinations/custom ────────────────────────
  @Public()
  @Post('custom')
  @ApiOperation({ summary: 'Add a custom vaccine or off-schedule dose' })
  addCustomVaccine(
    @Body() dto: AddCustomVaccineDto,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    const userId = user?.sub || 'default-user';
    return this.vaccinationsService.addCustomVaccine(userId, dto);
  }

  // ── DELETE /api/v1/vaccinations/record/:recordId ────────────
  @Public()
  @Delete('record/:recordId')
  @ApiOperation({ summary: 'Delete a vaccination record' })
  deleteRecord(
    @Param('recordId') recordId: string,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    const userId = user?.sub || 'default-user';
    return this.vaccinationsService.deleteVaccineRecord(userId, recordId);
  }

  // ── GET /api/v1/vaccinations/centers ────────────────────────
  @Public()
  @Get('centers')
  @ApiOperation({
    summary: 'Find nearby vaccination centers, PHCs, and immunization hospitals',
    description: 'Queries live OpenStreetMap and curated directory with distance calculation and vaccine stock availability.',
  })
  findNearbyCenters(@Query() query: FindNearbyCentersDto) {
    return this.vaccinationsService.findNearbyCenters(query);
  }

  // ── POST /api/v1/vaccinations/appointment ───────────────────
  @Public()
  @Post('appointment')
  @ApiOperation({ summary: 'Book a vaccination appointment slot at a center' })
  bookAppointment(
    @Body() dto: BookVaccineAppointmentDto,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    const userId = user?.sub || 'default-user';
    return this.vaccinationsService.bookAppointment(userId, dto);
  }

  // ── GET /api/v1/vaccinations/passport ───────────────────────
  @Public()
  @Get('passport')
  @ApiOperation({
    summary: 'Generate digital verifiable vaccination passport & QR certificate payload',
  })
  getVaccinationPassport(
    @Query('memberId') memberId?: string,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    const userId = user?.sub || 'default-user';
    return this.vaccinationsService.getVaccinationPassport(userId, memberId || 'mem-child');
  }

  // ── POST /api/v1/vaccinations/reminders/trigger ─────────────
  @Public()
  @Post('reminders/trigger')
  @ApiOperation({ summary: 'Trigger a vaccine dose milestone reminder notification' })
  triggerReminder(
    @Body() dto: TriggerVaccineReminderDto,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    const userId = user?.sub || 'default-user';
    return this.vaccinationsService.triggerReminder(userId, dto);
  }
}
