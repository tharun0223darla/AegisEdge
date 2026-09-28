import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { AiVoiceService } from './ai-voice.service';
import { SpeakToSessionDto } from './dto/voice-session.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/userrole.enum';

@ApiTags('AI Voice Companion')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ai-voice')
export class AiVoiceController {
  constructor(private readonly aiVoiceService: AiVoiceService) {}

  @Get('status')
  @Roles(UserRole.PATIENT, UserRole.DOCTOR, UserRole.CAREGIVER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Get configured AI companion provider status' })
  getStatus() {
    return this.aiVoiceService.getStatus();
  }

  @Post('session')
  @Roles(UserRole.PATIENT)
  @ApiOperation({
    summary: 'Initiate a new daily check-in session and receive greeting',
  })
  startSession(@CurrentUser() user: CurrentUserPayload) {
    return this.aiVoiceService.startSession(user.sub);
  }

  @Post('session/:id/respond')
  @Roles(UserRole.PATIENT)
  @ApiOperation({
    summary: 'Respond to AI check-in greeting/message and receive reply',
  })
  respondToSession(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') sessionId: string,
    @Body() dto: SpeakToSessionDto,
  ) {
    return this.aiVoiceService.respondToSession(
      user.sub,
      sessionId,
      dto.message,
    );
  }

  @Post('session/:id/complete')
  @Roles(UserRole.PATIENT)
  @ApiOperation({
    summary: 'Complete voice session and summarize user-reported information',
  })
  completeSession(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') sessionId: string,
  ) {
    return this.aiVoiceService.completeSession(user.sub, sessionId);
  }

  @Get('logs')
  @Roles(UserRole.PATIENT, UserRole.DOCTOR, UserRole.CAREGIVER)
  @ApiOperation({ summary: 'Retrieve check-in history summaries' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findLogs(
    @CurrentUser() user: CurrentUserPayload,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit?: number,
  ) {
    return this.aiVoiceService.findLogs(user.sub, limit);
  }
}
