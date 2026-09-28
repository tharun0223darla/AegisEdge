import { existsSync } from 'node:fs';
import dotenv from 'dotenv';

const DEFAULT_ENV_FILE = '.env.smoke.local';
const DEFAULT_TIMEOUT_MS = 120_000;
const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printUsage();
  process.exit(0);
}

const envFile = options.envFile ?? DEFAULT_ENV_FILE;
if (!existsSync(envFile)) {
  fail(`Credential file not found: ${envFile}`);
}
dotenv.config({ path: envFile, quiet: true });

const apiOrigin = requireHttpsOrigin(
  'API URL',
  options.apiUrl ?? process.env.PRODUCTION_API_URL,
);
const webOrigin = requireHttpsOrigin(
  'web URL',
  options.webUrl ?? process.env.PRODUCTION_WEB_URL,
);
const email = requireSecret('SMOKE_TEST_EMAIL');
const password = requireSecret('SMOKE_TEST_PASSWORD');
const medicineQuery = process.env.SMOKE_MEDICINE_QUERY?.trim() || 'Dolo 650';
const timeoutMs = parseTimeout(options.timeoutMs);

console.log('MediTrack authenticated production smoke check (non-destructive)');
console.log(`Web: ${webOrigin}`);
console.log(`API: ${apiOrigin}`);
console.log(`Account: ${maskEmail(email)}`);

const loginResponse = await request(
  `${apiOrigin}/api/auth/login`,
  {
    method: 'POST',
    headers: jsonHeaders(webOrigin),
    body: JSON.stringify({ email, password }),
  },
  timeoutMs,
);
assertStatus(loginResponse, [200], 'Patient login');
assertCorsOrigin(loginResponse, webOrigin, 'Patient login');
const loginPayload = await readJson(loginResponse, 'Patient login');
const session = loginPayload?.data;
if (
  typeof session?.accessToken !== 'string' ||
  !session.accessToken ||
  session?.user?.role !== 'PATIENT' ||
  session?.user?.isActive !== true ||
  session?.user?.isVerified !== true
) {
  fail('Login did not return an active, verified PATIENT session.');
}
pass('Verified patient login', loginResponse);

const authHeaders = {
  Authorization: `Bearer ${session.accessToken}`,
  Origin: webOrigin,
};

const meResponse = await request(
  `${apiOrigin}/api/auth/me`,
  { headers: authHeaders },
  timeoutMs,
);
assertStatus(meResponse, [200], 'Current-user identity');
const mePayload = await readJson(meResponse, 'Current-user identity');
if (
  mePayload?.data?.id !== session.user.id ||
  mePayload?.data?.email?.toLowerCase() !== email.toLowerCase()
) {
  fail('Current-user response did not match the authenticated account.');
}
pass('Current-user identity', meResponse);

const medicinesResponse = await request(
  `${apiOrigin}/api/medicines?limit=1&activeOnly=false`,
  { headers: authHeaders },
  timeoutMs,
);
assertStatus(medicinesResponse, [200], 'Patient medicine list');
await readJson(medicinesResponse, 'Patient medicine list');
pass('Patient medicine list', medicinesResponse);

const searchResponse = await request(
  `${apiOrigin}/api/medicines/master/search?q=${encodeURIComponent(medicineQuery)}&limit=3`,
  { headers: authHeaders },
  timeoutMs,
);
assertStatus(searchResponse, [200], 'Medicine master search');
const searchPayload = await readJson(searchResponse, 'Medicine master search');
if (!Array.isArray(searchPayload?.data) || searchPayload.data.length === 0) {
  fail(`Medicine master search returned no results for ${medicineQuery}.`);
}
pass('Medicine master search', searchResponse);

const allergiesResponse = await request(
  `${apiOrigin}/api/medication-safety/allergies`,
  { headers: authHeaders },
  timeoutMs,
);
assertStatus(allergiesResponse, [200], 'Medication-safety access');
const allergiesPayload = await readJson(
  allergiesResponse,
  'Medication-safety access',
);
if (!Array.isArray(allergiesPayload?.data)) {
  fail('Medication-safety allergies endpoint did not return a list.');
}
pass('Medication-safety schema and access', allergiesResponse);

const reportsResponse = await request(
  `${apiOrigin}/api/doctor-reports`,
  { headers: authHeaders },
  timeoutMs,
);
assertStatus(reportsResponse, [200], 'Doctor-report access');
const reportsPayload = await readJson(reportsResponse, 'Doctor-report access');
if (!Array.isArray(reportsPayload?.data)) {
  fail('Doctor-report endpoint did not return a list.');
}
pass('Doctor-report schema and access', reportsResponse);

const barriersResponse = await request(
  `${apiOrigin}/api/dose-logs/barriers/summary?days=30`,
  { headers: authHeaders },
  timeoutMs,
);
assertStatus(barriersResponse, [200], 'Adherence-barrier summary access');
const barriersPayload = await readJson(
  barriersResponse,
  'Adherence-barrier summary access',
);
const barriers = barriersPayload?.data;
if (
  !Number.isInteger(barriers?.periodDays) ||
  !Number.isInteger(barriers?.finalized) ||
  !Number.isInteger(barriers?.recorded) ||
  !Number.isInteger(barriers?.unrecorded) ||
  !Array.isArray(barriers?.reasons) ||
  typeof barriers?.disclaimer !== 'string'
) {
  fail('Adherence-barrier summary returned an unexpected schema.');
}
pass('Adherence-barrier summary schema and access', barriersResponse);

const adminResponse = await request(
  `${apiOrigin}/api/users?page=1&limit=1`,
  { headers: authHeaders },
  timeoutMs,
);
assertStatus(adminResponse, [403], 'Patient/admin role isolation');
pass('Patient is blocked from admin users', adminResponse);

console.log('\nAuthenticated production smoke check passed.');
console.log(
  'No medicine, schedule, dose action, barrier reason, allergy, report, or notification was created.',
);

async function request(url, init, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
    });
    response.durationMs = Date.now() - startedAt;
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'AbortError'
        ? `timed out after ${timeout} ms`
        : error instanceof Error
          ? error.message
          : 'unknown network error';
    fail(`${url} ${reason}.`);
  } finally {
    clearTimeout(timer);
  }
}

function jsonHeaders(origin) {
  return { 'Content-Type': 'application/json', Origin: origin };
}

function assertStatus(response, expected, label) {
  if (!expected.includes(response.status)) {
    fail(
      `${label} returned HTTP ${response.status}; expected ${expected.join(' or ')}.`,
    );
  }
}

function assertCorsOrigin(response, expectedOrigin, label) {
  const actual = response.headers.get('access-control-allow-origin');
  if (actual !== expectedOrigin) {
    fail(
      `${label} returned access-control-allow-origin=${actual ?? 'missing'}; expected ${expectedOrigin}.`,
    );
  }
}

async function readJson(response, label) {
  try {
    return await response.json();
  } catch {
    fail(`${label} did not return valid JSON.`);
  }
}

function pass(label, response) {
  console.log(`PASS ${label} (${response.status}, ${response.durationMs} ms)`);
}

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function requireSecret(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is missing from the smoke-test credential file.`);
  return value;
}

function requireHttpsOrigin(label, value) {
  if (!value) fail(`Missing ${label}.`);
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('invalid production origin');
    }
    return url.origin;
  } catch {
    fail(`${label} must be a valid HTTPS origin without credentials.`);
  }
}

function parseTimeout(value) {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 5_000 || parsed > 300_000) {
    fail('timeout-ms must be an integer between 5000 and 300000.');
  }
  return parsed;
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      parsed.help = true;
      continue;
    }
    const separator = argument.indexOf('=');
    const rawName = separator >= 0 ? argument.slice(0, separator) : argument;
    const inlineValue = separator >= 0 ? argument.slice(separator + 1) : null;
    const name = rawName.replace(/^--/, '');
    if (!['api-url', 'web-url', 'timeout-ms', 'env-file'].includes(name)) {
      fail(`Unknown argument: ${argument}`);
    }
    const value = inlineValue ?? args[index + 1];
    if (!value || value.startsWith('--')) {
      fail(`Missing value for --${name}.`);
    }
    if (inlineValue === null) index += 1;
    const key = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    parsed[key] = value;
  }
  return parsed;
}

function maskEmail(value) {
  const separator = value.lastIndexOf('@');
  if (separator <= 0) return 'invalid-email';
  return `${value.slice(0, Math.min(2, separator))}***${value.slice(separator)}`;
}

function printUsage() {
  console.log(`
Usage:
  npm run smoke:production:auth

Default credential file:
  .env.smoke.local

Required values:
  PRODUCTION_API_URL=https://api.example.com
  PRODUCTION_WEB_URL=https://app.example.com
  SMOKE_TEST_EMAIL=verified-test-patient@example.com
  SMOKE_TEST_PASSWORD=replace-with-test-account-password

Optional:
  SMOKE_MEDICINE_QUERY=Dolo 650
  --env-file path/to/protected.env
  --api-url https://api.example.com
  --web-url https://app.example.com
  --timeout-ms 120000
`);
}
