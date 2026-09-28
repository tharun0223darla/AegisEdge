import { validateEnv } from './env.validation';

describe('validateEnv production safety', () => {
  const base = {
    DATABASE_URL: 'postgresql://user:password@database.internal:5432/meditrack',
    JWT_SECRET: 'access-secret-with-more-than-thirty-two-characters',
    FRONTEND_URL: 'http://localhost:5173',
    EMAIL_VERIFICATION_ENABLED: 'true',
    EMAIL_VERIFICATION_PROVIDER: 'brevo',
    BREVO_API_KEY: 'test-brevo-key-for-validation',
    EMAIL_FROM_ADDRESS: 'verified-sender@example.com',
  };

  it('keeps local development configuration supported', () => {
    expect(
      validateEnv({
        ...base,
        NODE_ENV: 'development',
      }),
    ).toMatchObject({ NODE_ENV: 'development' });
  });

  it('rejects unsafe production URLs and missing refresh credentials', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        API_BASE_URL: 'http://api.example.com',
      }),
    ).toThrow('Unsafe production environment configuration');
  });

  it('accepts distinct secrets and HTTPS production origins', () => {
    expect(
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_REFRESH_SECRET:
          'refresh-secret-that-is-different-and-over-thirty-two-characters',
        API_BASE_URL: 'https://api.example.com',
        FRONTEND_URL: 'https://app.example.com',
      }),
    ).toMatchObject({ NODE_ENV: 'production' });
  });

  it('accepts authenticated SMTP for production email verification', () => {
    expect(
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_REFRESH_SECRET:
          'refresh-secret-that-is-different-and-over-thirty-two-characters',
        API_BASE_URL: 'https://api.example.com',
        FRONTEND_URL: 'https://app.example.com',
        EMAIL_VERIFICATION_PROVIDER: 'smtp',
        BREVO_API_KEY: undefined,
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_USER: 'sender@example.com',
        SMTP_PASSWORD: 'app-password-not-a-login-password',
      }),
    ).toMatchObject({
      NODE_ENV: 'production',
      EMAIL_VERIFICATION_PROVIDER: 'smtp',
      SMTP_PORT: 465,
    });
  });

  it('rejects incomplete SMTP production configuration', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_REFRESH_SECRET:
          'refresh-secret-that-is-different-and-over-thirty-two-characters',
        API_BASE_URL: 'https://api.example.com',
        FRONTEND_URL: 'https://app.example.com',
        EMAIL_VERIFICATION_PROVIDER: 'smtp',
        BREVO_API_KEY: undefined,
      }),
    ).toThrow('SMTP_HOST is required');
  });

  it('accepts Groq OpenAI-compatible base URLs with a path', () => {
    expect(
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_REFRESH_SECRET:
          'refresh-secret-that-is-different-and-over-thirty-two-characters',
        API_BASE_URL: 'https://api.example.com',
        FRONTEND_URL: 'https://app.example.com',
        GROQ_API_KEY: 'test-groq-key-for-validation',
        GROQ_BASE_URL: 'https://api.groq.com/openai/v1',
      }),
    ).toMatchObject({ NODE_ENV: 'production' });
  });

  it('accepts a token-protected OCR sidecar with fail-closed production fallback', () => {
    expect(
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_REFRESH_SECRET:
          'refresh-secret-that-is-different-and-over-thirty-two-characters',
        API_BASE_URL: 'https://api.example.com',
        FRONTEND_URL: 'https://app.example.com',
        OCR_SERVICE_URL: 'http://meditrack-ocr.internal:8000',
        OCR_SERVICE_TOKEN:
          'ocr-service-secret-that-is-longer-than-thirty-two-characters',
        OCR_ALLOW_TESSERACT_FALLBACK: 'false',
        PRESCRIPTION_VISION_MODE: 'sidecar',
      }),
    ).toMatchObject({
      OCR_SERVICE_URL: 'http://meditrack-ocr.internal:8000',
      PRESCRIPTION_VISION_MODE: 'sidecar',
    });
  });

  it('rejects an unprotected or permissive production OCR sidecar', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_REFRESH_SECRET:
          'refresh-secret-that-is-different-and-over-thirty-two-characters',
        API_BASE_URL: 'https://api.example.com',
        FRONTEND_URL: 'https://app.example.com',
        OCR_SERVICE_URL: 'https://ocr.example.com',
        OCR_SERVICE_TOKEN: 'short',
        OCR_ALLOW_TESSERACT_FALLBACK: 'true',
      }),
    ).toThrow('OCR_SERVICE_TOKEN must contain at least 32 characters');
  });
});
