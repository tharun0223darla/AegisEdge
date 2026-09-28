/**
 * Strongly-typed environment configuration.
 * All env vars MUST be prefixed with VITE_ to be exposed by Vite.
 */

function validateApiUrl(value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error('ConfigError: VITE_API_URL environment variable is required but missing.');
  }
  if (!value.startsWith('http://') && !value.startsWith('https://')) {
    throw new Error(`ConfigError: VITE_API_URL must start with "http://" or "https://". Received: "${value}"`);
  }
  return value;
}

export const env = {
  API_URL: validateApiUrl(import.meta.env.VITE_API_URL),
  APP_NAME: import.meta.env.VITE_APP_NAME ?? 'MediTrack AI',
  ENABLE_DEVTOOLS: import.meta.env.VITE_ENABLE_DEVTOOLS === 'true',
  IS_DEV: import.meta.env.DEV,
  IS_PROD: import.meta.env.PROD,
} as const;

export type AppEnv = typeof env;
