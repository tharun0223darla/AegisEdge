const DEFAULT_TIMEOUT_MS = 120_000;

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printUsage();
  process.exit(0);
}

const apiOrigin = requireHttpsOrigin(
  'API URL',
  options.apiUrl ?? process.env.PRODUCTION_API_URL,
);
const webOrigin = requireHttpsOrigin(
  'web URL',
  options.webUrl ?? process.env.PRODUCTION_WEB_URL,
);
const timeoutMs = parseTimeout(options.timeoutMs);

console.log('MediTrack production smoke check (read-only)');
console.log(`Web: ${webOrigin}`);
console.log(`API: ${apiOrigin}`);

const checks = [
  () => checkFrontend(webOrigin, timeoutMs),
  () => checkLiveness(apiOrigin, timeoutMs),
  () => checkReadiness(apiOrigin, timeoutMs),
  () => checkAuthBoundary(apiOrigin, webOrigin, timeoutMs),
  () => checkCorsPreflight(apiOrigin, webOrigin, timeoutMs),
];

for (const check of checks) {
  await check();
}

console.log('\nProduction smoke check passed.');

async function checkFrontend(origin, timeout) {
  const response = await timedFetch(`${origin}/`, {}, timeout);
  assertStatus(response, [200], 'Frontend');
  const body = await response.text();
  if (!body.includes('<div id="root"')) {
    fail('Frontend did not return the expected application shell.');
  }
  pass('Frontend application shell', response);
}

async function checkLiveness(origin, timeout) {
  const response = await timedFetch(`${origin}/health/live`, {}, timeout);
  assertStatus(response, [200], 'API liveness');
  const payload = await readJson(response, 'API liveness');
  if (payload?.data?.status !== 'ok') {
    fail('API liveness response did not report status=ok.');
  }
  pass('API liveness', response);
}

async function checkReadiness(origin, timeout) {
  const response = await timedFetch(`${origin}/health/ready`, {}, timeout);
  assertStatus(response, [200], 'API readiness');
  const payload = await readJson(response, 'API readiness');
  const databaseStatus =
    payload?.data?.details?.database?.status ??
    payload?.data?.info?.database?.status;
  if (payload?.data?.status !== 'ok' || databaseStatus !== 'up') {
    fail('API readiness response did not report database=up.');
  }
  pass('API readiness and database', response);
}

async function checkAuthBoundary(api, web, timeout) {
  const response = await timedFetch(
    `${api}/api/auth/me`,
    { headers: { Origin: web } },
    timeout,
  );
  assertStatus(response, [401], 'Authentication boundary');
  assertCorsOrigin(response, web, 'Authentication boundary');
  pass('Anonymous access is rejected', response);
}

async function checkCorsPreflight(api, web, timeout) {
  const response = await timedFetch(
    `${api}/api/auth/login`,
    {
      method: 'OPTIONS',
      headers: {
        Origin: web,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    },
    timeout,
  );
  assertStatus(response, [200, 204], 'CORS preflight');
  assertCorsOrigin(response, web, 'CORS preflight');
  const methods = response.headers.get('access-control-allow-methods') ?? '';
  if (!methods.toUpperCase().split(/\s*,\s*/).includes('POST')) {
    fail('CORS preflight did not allow POST.');
  }
  pass('Frontend-to-API CORS preflight', response);
}

async function timedFetch(url, init, timeout) {
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

function assertStatus(response, expected, label) {
  if (!expected.includes(response.status)) {
    fail(`${label} returned HTTP ${response.status}; expected ${expected.join(' or ')}.`);
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

function requireHttpsOrigin(label, value) {
  if (!value) {
    console.error(`Missing ${label}.`);
    printUsage();
    process.exit(1);
  }
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
    const [rawName, inlineValue] = argument.split('=', 2);
    const name = rawName.replace(/^--/, '');
    if (!['api-url', 'web-url', 'timeout-ms'].includes(name)) {
      fail(`Unknown argument: ${argument}`);
    }
    const value = inlineValue ?? args[index + 1];
    if (!value || value.startsWith('--')) {
      fail(`Missing value for --${name}.`);
    }
    if (inlineValue === undefined) index += 1;
    const key = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    parsed[key] = value;
  }
  return parsed;
}

function printUsage() {
  console.log(`
Usage:
  npm run smoke:production -- --api-url https://api.example.com --web-url https://app.example.com

Optional:
  --timeout-ms 120000

Environment alternatives:
  PRODUCTION_API_URL
  PRODUCTION_WEB_URL
`);
}
