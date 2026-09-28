import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key consumed by JwtAuthGuard to bypass authentication on
 * explicitly-marked public routes (login, register, health, etc.).
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route handler or controller as publicly accessible (no JWT required).
 *
 * @example
 *   @Public()
 *   @Get('health')
 *   ping() { return { ok: true }; }
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
