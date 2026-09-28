import {
  Controller,
  Body,
  Get,
  Patch,
  Post,
  Param,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { NotificationsService } from './notifications.service';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';

import { UserRole } from '../common/enums/userrole.enum';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';

@ApiTags('Notifications')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PATIENT, UserRole.CAREGIVER, UserRole.DOCTOR, UserRole.ADMIN)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // GET /notifications
  @Get()
  @ApiOperation({
    summary: 'Get user notifications',
  })
  getNotifications(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.getNotifications(user.sub);
  }

  // GET /notifications/unread-count
  @Get('unread-count')
  @ApiOperation({
    summary: 'Get unread notification count',
  })
  getUnreadCount(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.getUnreadCount(user.sub);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Get persisted notification preferences' })
  getPreferences(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.getPreferences(user.sub);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update persisted notification preferences' })
  updatePreferences(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.notificationsService.updatePreferences(user.sub, dto);
  }

  @Post('test-phone')
  @ApiOperation({
    summary: 'Send a test phone notification to the registered number',
  })
  sendTestPhoneNotification(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.sendPhoneTest(user.sub);
  }

  @Post('test-email')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a test email to the verified account email' })
  sendTestEmailNotification(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.sendEmailTest(user.sub);
  }
  // POST /notifications/read-all
  @Post('read-all')
  @ApiOperation({
    summary: 'Mark all notifications as read',
  })
  async markAllRead(@CurrentUser() user: CurrentUserPayload) {
    await this.notificationsService.markAllAsRead(user.sub);
    return { success: true };
  }

  // PATCH /notifications/:id/read
  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark notification as read',
  })
  markAsRead(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.notificationsService.markAsRead(id, user.sub);
  }
}
