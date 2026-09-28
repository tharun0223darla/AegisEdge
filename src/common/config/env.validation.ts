import { plainToInstance, Transform } from 'class-transformer';
import {
  IsEnum,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export class EnvVars {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @MinLength(1)
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32, {
    message:
      'JWT_SECRET must be at least 32 characters (use `openssl rand -base64 64`)',
  })
  JWT_SECRET!: string;

  @IsString()
  @IsOptional()
  JWT_EXPIRES_IN?: string = '7d';

  @IsString()
  @IsOptional()
  JWT_REFRESH_SECRET?: string;

  @IsString()
  @IsOptional()
  JWT_REFRESH_EXPIRES_IN?: string = '30d';

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(4)
  @Max(15)
  @IsOptional()
  BCRYPT_ROUNDS: number = 12;

  @IsString()
  @IsOptional()
  API_BASE_URL?: string;

  @IsString()
  @MinLength(1)
  FRONTEND_URL!: string;

  @IsString()
  @IsOptional()
  CORS_ORIGINS?: string;

  @IsString()
  @IsOptional()
  LOG_LEVEL?: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  @Max(5)
  @IsOptional()
  TRUST_PROXY: number = 0;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @IsOptional()
  MAX_UPLOAD_SIZE_MB: number = 5;

  @IsString()
  @IsOptional()
  OCR_SERVICE_URL?: string;

  @IsString()
  @IsOptional()
  OCR_SERVICE_TOKEN?: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1000)
  @Max(300000)
  @IsOptional()
  OCR_HTTP_TIMEOUT_MS: number = 135000;

  @IsString()
  @IsOptional()
  OCR_ALLOW_TESSERACT_FALLBACK?: string;

  @IsString()
  @IsOptional()
  PRESCRIPTION_VISION_MODE?: string;

  @IsString()
  @IsOptional()
  OLLAMA_URL?: string;

  @IsString()
  @IsOptional()
  OLLAMA_MODEL?: string;

  @IsString()
  @IsOptional()
  GROQ_API_KEY?: string;

  @IsString()
  @IsOptional()
  GROQ_MODEL?: string;

  @IsString()
  @IsOptional()
  GROQ_BASE_URL?: string;

  @IsString()
  @IsOptional()
  AI_PROVIDER_ORDER?: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(2000)
  @Max(60000)
  @IsOptional()
  AI_REQUEST_TIMEOUT_MS: number = 15000;

  @IsString()
  @IsOptional()
  TAVILY_API_KEY?: string;

  @IsString()
  @IsOptional()
  WEB_SOURCE_SEARCH_DEPTH?: string;

  @IsString()
  @IsOptional()
  WEB_SOURCE_SEARCH_COUNTRY?: string;

  @IsString()
  @IsOptional()
  WEB_SOURCE_SEARCH_MAX_RESULTS?: string;

  @IsString()
  @IsOptional()
  PHONE_NOTIFICATIONS_ENABLED?: string;

  @IsString()
  @IsOptional()
  PHONE_NOTIFICATION_PROVIDER?: string;

  @IsString()
  @IsOptional()
  PHONE_NOTIFICATION_DEFAULT_COUNTRY_CODE?: string;

  @IsString()
  @IsOptional()
  PHONE_NOTIFICATION_INCLUDE_MEDICINE_NAME?: string;

  @IsString()
  @IsOptional()
  PHONE_NOTIFICATION_REQUIRE_VERIFIED_USER?: string;

  @IsString()
  @IsOptional()
  TWILIO_ACCOUNT_SID?: string;

  @IsString()
  @IsOptional()
  TWILIO_AUTH_TOKEN?: string;

  @IsString()
  @IsOptional()
  TWILIO_FROM_NUMBER?: string;

  @IsString()
  @IsOptional()
  PHONE_NOTIFICATION_WEBHOOK_URL?: string;

  @IsString()
  @IsOptional()
  PHONE_NOTIFICATION_WEBHOOK_API_KEY?: string;

  @IsString()
  @IsOptional()
  EMAIL_VERIFICATION_ENABLED?: string;

  @IsString()
  @IsOptional()
  EMAIL_VERIFICATION_PROVIDER?: string;

  @IsString()
  @IsOptional()
  BREVO_API_KEY?: string;

  @IsString()
  @IsOptional()
  SMTP_HOST?: string;

  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  SMTP_PORT?: number;

  @IsString()
  @IsOptional()
  SMTP_SECURE?: string;

  @IsString()
  @IsOptional()
  SMTP_USER?: string;

  @IsString()
  @IsOptional()
  SMTP_PASSWORD?: string;

  @IsEmail()
  @IsOptional()
  EMAIL_FROM_ADDRESS?: string;

  @IsString()
  @IsOptional()
  EMAIL_FROM_NAME?: string;

  @IsString()
  @IsOptional()
  EMAIL_NOTIFICATIONS_ENABLED?: string;
}

export function validateEnv(raw: Record<string, unknown>): EnvVars {
  const parsed = plainToInstance(EnvVars, raw);

  const errors = validateSync(parsed, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const summary = errors
      .map((error) => {
        const constraints = error.constraints
          ? Object.values(error.constraints).join('; ')
          : 'invalid value';
        return `  - ${error.property}: ${constraints}`;
      })
      .join('\n');

    throw new Error(
      `\nInvalid environment configuration:\n${summary}\n\n` +
        'Copy `.env.example` to `.env` and populate the missing variables.\n',
    );
  }

  if (parsed.NODE_ENV === NodeEnv.Production) {
    validateProductionRuntime(parsed);
  }

  return parsed;
}

function validateProductionRuntime(env: EnvVars): void {
  const issues: string[] = [];

  if (!env.JWT_REFRESH_SECRET || env.JWT_REFRESH_SECRET.length < 32) {
    issues.push('JWT_REFRESH_SECRET must contain at least 32 characters.');
  }
  if (env.JWT_REFRESH_SECRET === env.JWT_SECRET) {
    issues.push('JWT_REFRESH_SECRET must be different from JWT_SECRET.');
  }

  validateHttpsUrl('API_BASE_URL', env.API_BASE_URL, issues);
  if (env.GROQ_API_KEY && env.GROQ_BASE_URL) {
    validateHttpsUrl('GROQ_BASE_URL', env.GROQ_BASE_URL, issues, {
      allowPath: true,
    });
  }

  if (env.OCR_SERVICE_URL?.trim()) {
    try {
      const ocrUrl = new URL(env.OCR_SERVICE_URL);
      if (!['http:', 'https:'].includes(ocrUrl.protocol)) {
        issues.push('OCR_SERVICE_URL must use HTTP or HTTPS.');
      }
      if (ocrUrl.search || ocrUrl.hash) {
        issues.push(
          'OCR_SERVICE_URL must not include query parameters or fragments.',
        );
      }
    } catch {
      issues.push('OCR_SERVICE_URL must be a valid URL.');
    }
    if (!env.OCR_SERVICE_TOKEN || env.OCR_SERVICE_TOKEN.length < 32) {
      issues.push(
        'OCR_SERVICE_TOKEN must contain at least 32 characters when OCR_SERVICE_URL is configured.',
      );
    }
    if (env.OCR_ALLOW_TESSERACT_FALLBACK !== 'false') {
      issues.push(
        'OCR_ALLOW_TESSERACT_FALLBACK must be false in production when the OCR sidecar is configured.',
      );
    }
  }
  if (
    env.PRESCRIPTION_VISION_MODE &&
    !['auto', 'local', 'sidecar'].includes(
      env.PRESCRIPTION_VISION_MODE.trim().toLowerCase(),
    )
  ) {
    issues.push('PRESCRIPTION_VISION_MODE must be auto, local, or sidecar.');
  }

  if (env.EMAIL_VERIFICATION_ENABLED !== 'true') {
    issues.push('EMAIL_VERIFICATION_ENABLED must be true in production.');
  }
  const emailProvider = env.EMAIL_VERIFICATION_PROVIDER?.trim().toLowerCase();
  if (emailProvider !== 'brevo' && emailProvider !== 'smtp') {
    issues.push(
      'EMAIL_VERIFICATION_PROVIDER must be brevo or smtp in production.',
    );
  }
  if (emailProvider === 'brevo' && !env.BREVO_API_KEY?.trim()) {
    issues.push(
      'BREVO_API_KEY is required when EMAIL_VERIFICATION_PROVIDER=brevo.',
    );
  }
  if (emailProvider === 'smtp') {
    if (!env.SMTP_HOST?.trim()) {
      issues.push('SMTP_HOST is required for SMTP email verification.');
    }
    if (!env.SMTP_PORT) {
      issues.push('SMTP_PORT is required for SMTP email verification.');
    }
    if (
      !['true', 'false'].includes(env.SMTP_SECURE?.trim().toLowerCase() ?? '')
    ) {
      issues.push(
        'SMTP_SECURE must be true or false for SMTP email verification.',
      );
    }
    if (!env.SMTP_USER?.trim()) {
      issues.push('SMTP_USER is required for SMTP email verification.');
    }
    if (!env.SMTP_PASSWORD?.trim()) {
      issues.push('SMTP_PASSWORD is required for SMTP email verification.');
    }
  }
  if (!env.EMAIL_FROM_ADDRESS?.trim()) {
    issues.push(
      'EMAIL_FROM_ADDRESS is required for production email verification.',
    );
  }

  const frontendOrigins = env.FRONTEND_URL.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (frontendOrigins.length === 0) {
    issues.push('FRONTEND_URL must contain at least one HTTPS origin.');
  }
  for (const origin of frontendOrigins) {
    if (origin === '*') {
      issues.push('FRONTEND_URL must not contain a wildcard origin.');
      continue;
    }
    validateHttpsUrl('FRONTEND_URL', origin, issues);
  }

  if (issues.length > 0) {
    throw new Error(
      `\nUnsafe production environment configuration:\n${issues
        .map((issue) => `  - ${issue}`)
        .join('\n')}\n`,
    );
  }
}

function validateHttpsUrl(
  name: string,
  value: string | undefined,
  issues: string[],
  options: { allowPath?: boolean } = {},
): void {
  if (!value) {
    issues.push(`${name} is required in production.`);
    return;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') issues.push(`${name} must use HTTPS.`);
    if (!options.allowPath && parsed.pathname !== '/') {
      issues.push(`${name} must be an origin without a path.`);
    }
    if (parsed.search || parsed.hash) {
      issues.push(`${name} must not include query parameters or fragments.`);
    }
  } catch {
    issues.push(`${name} must be a valid URL.`);
  }
}
