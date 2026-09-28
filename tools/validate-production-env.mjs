import fs from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const scopeArg = process.argv.find((value) => value.startsWith('--scope='));
const scope = scopeArg?.split('=', 2)[1] ?? 'all';
const envFileArg = process.argv.find((value) =>
  value.startsWith('--env-file='),
);
const envFile = envFileArg?.slice('--env-file='.length);
const allowLocal = args.has('--allow-local');
const requireAndroidSigning = args.has('--require-android-signing');

if (!['all', 'backend', 'web'].includes(scope)) {
  fail([`Unsupported validation scope: ${scope}`]);
}

const fileValues = envFile ? readEnvFile(envFile) : {};
const env = { ...fileValues, ...process.env };
const errors = [];

if (scope === 'all' || scope === 'backend') {
  requireExact('NODE_ENV', 'production');
  requirePostgresUrl('DATABASE_URL');
  requireSecret('JWT_SECRET', 48);
  requireSecret('JWT_REFRESH_SECRET', 48);

  if (
    env.JWT_SECRET &&
    env.JWT_REFRESH_SECRET &&
    env.JWT_SECRET === env.JWT_REFRESH_SECRET
  ) {
    errors.push('JWT_REFRESH_SECRET must be different from JWT_SECRET.');
  }

  requireHttpsUrl('API_BASE_URL', { allowPath: false });
  requireHttpsOrigins('FRONTEND_URL');
  requireMedicalFileStorageContract();
  requireOcrServiceContract();
  requireExact('EMAIL_VERIFICATION_ENABLED', 'true');
  requireEmail('EMAIL_FROM_ADDRESS');
  const emailProvider = env.EMAIL_VERIFICATION_PROVIDER?.trim().toLowerCase();
  if (!['brevo', 'smtp'].includes(emailProvider ?? '')) {
    errors.push('EMAIL_VERIFICATION_PROVIDER must be brevo or smtp.');
  } else if (emailProvider === 'brevo') {
    requireValue('BREVO_API_KEY');
  } else {
    requireValue('SMTP_HOST');
    requireInteger('SMTP_PORT', 1, 65535);
    if (
      !['true', 'false'].includes(env.SMTP_SECURE?.trim().toLowerCase() ?? '')
    ) {
      errors.push('SMTP_SECURE must be true or false.');
    }
    requireValue('SMTP_USER');
    requireValue('SMTP_PASSWORD');
  }

  if (env.PHONE_NOTIFICATIONS_ENABLED === 'true') {
    const provider = env.PHONE_NOTIFICATION_PROVIDER;
    if (!['twilio', 'generic-webhook'].includes(provider ?? '')) {
      errors.push(
        'PHONE_NOTIFICATION_PROVIDER must be twilio or generic-webhook when phone notifications are enabled.',
      );
    }
    if (provider === 'twilio') {
      requireValue('TWILIO_ACCOUNT_SID');
      requireValue('TWILIO_AUTH_TOKEN');
      requireValue('TWILIO_FROM_NUMBER');
    }
    if (provider === 'generic-webhook') {
      requireHttpsUrl('PHONE_NOTIFICATION_WEBHOOK_URL', { allowPath: true });
      requireValue('PHONE_NOTIFICATION_WEBHOOK_API_KEY');
    }
  }
}

if (scope === 'all' || scope === 'web') {
  requireHttpsUrl('VITE_API_URL', { allowPath: true });
  const apiUrl = parseUrl(env.VITE_API_URL);
  if (apiUrl && !apiUrl.pathname.replace(/\/$/, '').endsWith('/api')) {
    errors.push('VITE_API_URL must include the /api path.');
  }
  if (env.VITE_ENABLE_DEVTOOLS === 'true') {
    errors.push('VITE_ENABLE_DEVTOOLS must be false in production.');
  }
}

if (requireAndroidSigning) {
  for (const name of [
    'ANDROID_KEYSTORE_PATH',
    'ANDROID_KEYSTORE_PASSWORD',
    'ANDROID_KEY_ALIAS',
    'ANDROID_KEY_PASSWORD',
    'ANDROID_VERSION_CODE',
    'ANDROID_VERSION_NAME',
    'GIT_COMMIT_SHA',
  ]) {
    requireValue(name);
  }

  if (
    env.ANDROID_VERSION_CODE &&
    (!/^\d+$/.test(env.ANDROID_VERSION_CODE) ||
      Number(env.ANDROID_VERSION_CODE) <= 0)
  ) {
    errors.push('ANDROID_VERSION_CODE must be a positive integer.');
  }

  if (env.GIT_COMMIT_SHA && !/^[0-9a-f]{7,40}$/i.test(env.GIT_COMMIT_SHA)) {
    errors.push('GIT_COMMIT_SHA must be a 7-40 character Git commit SHA.');
  }

  const keystorePath = env.ANDROID_KEYSTORE_PATH;
  if (keystorePath) {
    const resolved = path.resolve(keystorePath);
    if (!fs.existsSync(resolved)) {
      errors.push(`ANDROID_KEYSTORE_PATH does not exist: ${resolved}`);
    }
  }
}

if (errors.length > 0) fail(errors);

const suffix = requireAndroidSigning ? ' with Android signing' : '';
console.log(`Production environment validation passed (${scope}${suffix}).`);

function requireMedicalFileStorageContract() {
  const mode = env.MEDICAL_FILE_STORAGE?.trim();
  if (!mode) {
    errors.push(
      'MEDICAL_FILE_STORAGE is required and must be private-object, persistent-local, or demo-ephemeral-local.',
    );
    return;
  }

  if (
    !['private-object', 'persistent-local', 'demo-ephemeral-local'].includes(
      mode,
    )
  ) {
    errors.push(
      'MEDICAL_FILE_STORAGE must be private-object, persistent-local, or demo-ephemeral-local.',
    );
    return;
  }

  if (mode === 'private-object') {
    requireValue('MEDICAL_FILE_STORAGE_BUCKET');
    return;
  }

  if (mode === 'persistent-local') {
    requireValue('UPLOADS_VOLUME_PATH');
    return;
  }

  if (env.ALLOW_DEMO_EPHEMERAL_MEDICAL_UPLOADS !== 'true') {
    errors.push(
      'demo-ephemeral-local medical storage requires ALLOW_DEMO_EPHEMERAL_MEDICAL_UPLOADS=true because uploaded medical files may be lost on restart/redeploy.',
    );
  }
}

function requireOcrServiceContract() {
  const serviceUrl = env.OCR_SERVICE_URL?.trim();
  if (!serviceUrl) return;

  const parsed = parseUrl(serviceUrl, 'OCR_SERVICE_URL');
  if (parsed && !['http:', 'https:'].includes(parsed.protocol)) {
    errors.push('OCR_SERVICE_URL must use HTTP or HTTPS.');
  }
  requireSecret('OCR_SERVICE_TOKEN', 32);
  if (env.OCR_ALLOW_TESSERACT_FALLBACK !== 'false') {
    errors.push(
      'OCR_ALLOW_TESSERACT_FALLBACK must be false when OCR_SERVICE_URL is configured in production.',
    );
  }
  if (env.PRESCRIPTION_VISION_MODE !== 'sidecar') {
    errors.push(
      'PRESCRIPTION_VISION_MODE must be sidecar when OCR_SERVICE_URL is configured in production.',
    );
  }
}
function readEnvFile(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved))
    fail([`Environment file not found: ${resolved}`]);

  const values = {};
  for (const rawLine of fs.readFileSync(resolved, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function requireValue(name) {
  if (!env[name]?.trim()) errors.push(`${name} is required.`);
}

function requireInteger(name, minimum, maximum) {
  const value = env[name];
  if (
    !value ||
    !/^\d+$/.test(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  ) {
    errors.push(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
}

function requireEmail(name) {
  const value = env[name]?.trim();
  if (!value) {
    errors.push(`${name} is required.`);
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    errors.push(`${name} must be a valid email address.`);
  }
}

function requireExact(name, expected) {
  if (env[name] !== expected) errors.push(`${name} must be ${expected}.`);
}

function requireSecret(name, minimumLength) {
  const value = env[name]?.trim();
  if (!value) {
    errors.push(`${name} is required.`);
    return;
  }
  if (value.length < minimumLength) {
    errors.push(`${name} must contain at least ${minimumLength} characters.`);
  }
  if (/^(change-me|secret|password|test|example)/i.test(value)) {
    errors.push(`${name} still looks like a placeholder.`);
  }
}

function requirePostgresUrl(name) {
  const value = env[name]?.trim();
  if (!value) {
    errors.push(`${name} is required.`);
    return;
  }
  const parsed = parseUrl(value, name);
  if (!parsed) return;
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    errors.push(`${name} must use postgresql:// or postgres://.`);
  }
  rejectLocalHost(name, parsed);
}

function requireHttpsOrigins(name) {
  const value = env[name]?.trim();
  if (!value) {
    errors.push(`${name} is required.`);
    return;
  }
  for (const origin of value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)) {
    if (origin === '*') {
      errors.push(`${name} must not contain a wildcard origin.`);
      continue;
    }
    const parsed = parseUrl(origin, name);
    if (!parsed) continue;
    if (parsed.protocol !== 'https:')
      errors.push(`${name} origins must use HTTPS.`);
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
      errors.push(
        `${name} entries must be origins without paths, queries, or fragments.`,
      );
    }
    rejectLocalHost(name, parsed);
  }
}

function requireHttpsUrl(name, { allowPath }) {
  const value = env[name]?.trim();
  if (!value) {
    errors.push(`${name} is required.`);
    return;
  }
  const parsed = parseUrl(value, name);
  if (!parsed) return;
  if (parsed.protocol !== 'https:') errors.push(`${name} must use HTTPS.`);
  if (!allowPath && parsed.pathname !== '/') {
    errors.push(`${name} must be an origin without a path.`);
  }
  rejectLocalHost(name, parsed);
}

function parseUrl(value, name = 'URL') {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    errors.push(`${name} is not a valid URL.`);
    return null;
  }
}

function rejectLocalHost(name, parsed) {
  if (allowLocal) return;
  const host = parsed.hostname.toLowerCase();
  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  if (isLocal)
    errors.push(
      `${name} must not point to localhost or a private LAN address.`,
    );
}

function fail(messages) {
  console.error('Production environment validation failed:');
  for (const message of messages) console.error(`  - ${message}`);
  process.exit(1);
}
