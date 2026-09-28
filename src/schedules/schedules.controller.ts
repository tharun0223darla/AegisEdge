import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  DefaultValuePipe,
  ParseIntPipe,
  ParseBoolPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { SchedulesService } from './schedules.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/userrole.enum';

@ApiTags('Schedules')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PATIENT)
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new medicine schedule' })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateScheduleDto,
  ) {
    return this.schedulesService.create(user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all my medicine schedules' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean })
  findAll(
    @CurrentUser() user: CurrentUserPayload,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('activeOnly', new DefaultValuePipe(false), ParseBoolPipe)
    activeOnly: boolean,
  ) {
    return this.schedulesService.findAll(
      user.sub,
      page,
      Math.min(limit, 100),
      activeOnly,
    );
  }

  @Get('today')
  @ApiOperation({ summary: "Get today's dose schedule" })
  @ApiQuery({ name: 'timezone', required: false, type: String })
  getTodaysDoses(
    @CurrentUser() user: CurrentUserPayload,
    @Query('timezone', new DefaultValuePipe('UTC')) timezone: string,
  ) {
    return this.schedulesService.getTodaysDoses(user.sub, timezone);
  }

  @Get('mobile-reminders')
  @ApiOperation({
    summary:
      'Get upcoming dose reminders for mobile local notification scheduling',
  })
  @ApiQuery({ name: 'days', required: false, type: Number })
  getMobileReminderPlan(
    @CurrentUser() user: CurrentUserPayload,
    @Query('days', new DefaultValuePipe(14), ParseIntPipe) days: number,
  ) {
    return this.schedulesService.getMobileReminderPlan(user.sub, days);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific schedule by id' })
  findOne(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.schedulesService.findOne(user.sub, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a medicine schedule' })
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.schedulesService.update(user.sub, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate (stop) a medicine schedule' })
  deactivate(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.schedulesService.deactivate(user.sub, id);
  }
}
