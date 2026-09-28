import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

export function isDevelopmentLanOrigin(origin?: string | null): boolean {
  if (!origin || process.env.NODE_ENV === 'production') {
    return false;
  }

  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return true;
    }

    return (
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Generates and returns a production-safe CORS configuration.
 * Always rejects wildcards '*' when credentials mode is enabled to prevent browser blocking.
 */
export function getCorsConfig(): CorsOptions {
  const frontendUrl = process.env.FRONTEND_URL;
  if (!frontendUrl) {
    throw new Error('Configuration Error: FRONTEND_URL environment variable is missing.');
  }

  const origins = frontendUrl
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error('Configuration Error: FRONTEND_URL contains no valid origins.');
  }

  const parsedOrigins: string[] = [];

  for (const origin of origins) {
    // Crucial Rule: credentials:true and origin:"*" cannot coexist in browsers
    if (origin === '*') {
      throw new Error(
        'Configuration Error: Wildcard "*" is strictly prohibited in FRONTEND_URL when credentials are enabled.',
      );
    }

    try {
      const parsedUrl = new URL(origin);
      // Normalize by removing trailing slashes and any paths to match browser Origin header format
      const normalized = `${parsedUrl.protocol}//${parsedUrl.host}`;
      parsedOrigins.push(normalized);
    } catch (err) {
      throw new Error(`Configuration Error: Invalid URL structure in FRONTEND_URL: "${origin}".`);
    }
  }

  return {
    origin: (origin, callback) => {
      // If the request has no origin (e.g. server-to-server or non-browser client like mobile/curl), allow it.
      if (!origin || parsedOrigins.includes(origin) || isDevelopmentLanOrigin(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'Origin', 'Cookie'],
    exposedHeaders: ['Set-Cookie'],
    maxAge: 86400,
    preflightContinue: false,
  };
}
