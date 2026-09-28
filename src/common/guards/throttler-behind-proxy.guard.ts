import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * ThrottlerBehindProxyGuard
 * -----------------------------------------------------------------------------
 * Extends the default ThrottlerGuard so that when the API runs behind a
 * reverse proxy (Nginx / Cloudflare / AWS ALB / Heroku), rate-limiting keys
 * are derived from the real client IP (x-forwarded-for) instead of the
 * proxy's loopback address.
 *
 * Enable `app.set('trust proxy', 1)` in main.ts for this to function.
 */
@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const forwarded = req?.headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
    if (Array.isArray(forwarded) && forwarded.length > 0) {
      return String(forwarded[0]).trim();
    }
    return req?.ip ?? req?.connection?.remoteAddress ?? 'unknown';
  }
}
