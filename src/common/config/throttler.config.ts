import { ThrottlerModuleOptions } from '@nestjs/throttler';

/**
 * Multi-tier throttling profile.
 * -----------------------------------------------------------------------------
 *  - short  : burst protection (10 req / second)
 *  - medium : per-minute ceiling (100 req / minute)
 *  - long   : sustained-traffic ceiling (500 req / 15 minutes)
 *
 * Per-route overrides (e.g. login, register, forgot-password) are configured
 * via `@Throttle({ default: { limit, ttl } })` directly on those handlers.
 */
export const throttlerConfig: ThrottlerModuleOptions = [
  {
    name: 'short',
    ttl: 1_000,
    limit: 10,
  },
  {
    name: 'medium',
    ttl: 60_000,
    limit: 100,
  },
  {
    name: 'long',
    ttl: 15 * 60_000,
    limit: 500,
  },
];
