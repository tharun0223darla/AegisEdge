import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Request } from 'express';
import { isDevelopmentLanOrigin } from '../config/cors.config';

/**
 * Guard that enforces strict checking of the 'origin' header.
 * Requests coming from unexpected web origins are immediately blocked with a 403 Forbidden.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly logger = new Logger('OriginGuard');

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;

    // Allow requests without an Origin header (such as same-origin requests, mobile clients, curl, etc.)
    if (!origin) {
      return true;
    }

    const frontendUrl = process.env.FRONTEND_URL;
    if (!frontendUrl) {
      this.logger.error('Startup validation failed at request time: FRONTEND_URL environment variable is missing.');
      throw new ForbiddenException('Server configuration error.');
    }

    const allowedOrigins = frontendUrl
      .split(',')
      .map((url) => {
        try {
          const parsed = new URL(url.trim());
          return `${parsed.protocol}//${parsed.host}`;
        } catch {
          return null;
        }
      })
      .filter((url): url is string => !!url);

    if (allowedOrigins.includes(origin) || isDevelopmentLanOrigin(origin)) {
      return true;
    }

    // Log the blocked origin exactly as requested and return 403
    this.logger.warn(`Blocked origin: ${origin}`);
    throw new ForbiddenException(`Forbidden origin access: ${origin}`);
  }
}
