import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { RefillsService } from './refills.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/userrole.enum';
import { CorrectStockDto } from './dto/correct-stock.dto';
import { CreateRefillOrderDto } from './dto/create-refill-order.dto';
import { ReceiveRefillOrderDto } from './dto/receive-refill-order.dto';

@ApiTags('Refills')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PATIENT)
@Controller('refills')
export class RefillsController {
  constructor(private readonly refillsService: RefillsService) {}

  // ── GET /api/v1/refills ────────────────────────────────────
  @Get()
  @ApiOperation({ summary: 'List all my refill logs (from confirmed bills)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(
    @CurrentUser() user: CurrentUserPayload,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.refillsService.findAll(user.sub, page, Math.min(limit, 50));
  }

  // ── GET /api/v1/refills/upcoming ──────────────────────────
  @Get('upcoming')
  @ApiOperation({
    summary: 'Get medicines needing a refill soon',
    description:
      'Returns medicines whose refill reminder date falls within the look-ahead window. ' +
      'Includes urgency level: overdue | urgent | soon | upcoming.',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    type: Number,
    description: 'Look-ahead window in days (default: 7)',
  })
  getUpcoming(
    @CurrentUser() user: CurrentUserPayload,
    @Query('days', new DefaultValuePipe(7), ParseIntPipe) days: number,
  ) {
    const safeDays = Math.min(Math.max(days, 1), 90);
    return this.refillsService.getUpcoming(user.sub, safeDays);
  }

  // ── GET /api/v1/refills/stock-summary ─────────────────────
  @Get('stock-summary')
  @ApiOperation({
    summary: 'Current stock status for all active medicines',
    description:
      'Shows remaining quantity, estimated days left, and stock status for each medicine. ' +
      'Used for the medicine cabinet overview screen.',
  })
  getStockSummary(@CurrentUser() user: CurrentUserPayload) {
    return this.refillsService.getStockSummary(user.sub);
  }

  // ── GET /api/v1/refills/medicines/:medicineId/jan-aushadhi ──
  @Get('medicines/:medicineId/jan-aushadhi')
  @ApiOperation({
    summary: 'Find Jan Aushadhi generic alternative with pricing comparison',
  })
  getGenericSubstitute(
    @CurrentUser() user: CurrentUserPayload,
    @Param('medicineId') medicineId: string,
  ) {
    return this.refillsService.getGenericSubstitute(user.sub, medicineId);
  }

  // ── GET /api/v1/refills/:id ────────────────────────────────
  @Post('medicines/:medicineId/orders')
  @ApiOperation({
    summary: 'Record that a refill was ordered without changing stock',
  })
  createOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Param('medicineId') medicineId: string,
    @Body() dto: CreateRefillOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.refillsService.createOrder(
      user.sub,
      medicineId,
      dto,
      this.requireIdempotencyKey(idempotencyKey),
    );
  }

  @Post('orders/:orderId/receive')
  @ApiOperation({
    summary: 'Confirm a refill was received and add it to stock exactly once',
  })
  receiveOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Param('orderId') orderId: string,
    @Body() dto: ReceiveRefillOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.refillsService.receiveOrder(
      user.sub,
      orderId,
      dto,
      this.requireIdempotencyKey(idempotencyKey),
    );
  }

  @Patch('orders/:orderId/cancel')
  @ApiOperation({ summary: 'Cancel an outstanding refill order' })
  cancelOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Param('orderId') orderId: string,
  ) {
    return this.refillsService.cancelOrder(user.sub, orderId);
  }

  @Post('medicines/:medicineId/stock-corrections')
  @ApiOperation({ summary: 'Reconcile current stock after a physical count' })
  correctStock(
    @CurrentUser() user: CurrentUserPayload,
    @Param('medicineId') medicineId: string,
    @Body() dto: CorrectStockDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.refillsService.correctStock(
      user.sub,
      medicineId,
      dto,
      this.requireIdempotencyKey(idempotencyKey),
    );
  }

  @Get('medicines/:medicineId/history')
  @ApiOperation({
    summary: 'Get refill and stock adjustment history for one medicine',
  })
  getMedicineHistory(
    @CurrentUser() user: CurrentUserPayload,
    @Param('medicineId') medicineId: string,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
  ) {
    return this.refillsService.getMedicineHistory(
      user.sub,
      medicineId,
      Math.min(Math.max(limit, 1), 100),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific refill log by id' })
  findOne(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.refillsService.findOne(user.sub, id);
  }

  private requireIdempotencyKey(value?: string) {
    const key = value?.trim();
    if (!key || key.length < 8 || key.length > 120) {
      throw new BadRequestException(
        'Idempotency-Key header must contain 8 to 120 characters.',
      );
    }
    return key;
  }
}
