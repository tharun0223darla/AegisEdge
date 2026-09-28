import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(root, 'apps', 'web');
const androidRoot = path.join(webRoot, 'android');
const args = new Set(process.argv.slice(2));
const isCi = args.has('--ci');
const skipAndroid = args.has('--skip-android');
const envFileArg = process.argv.find((value) =>
  value.startsWith('--env-file='),
);
const envFile = envFileArg?.slice('--env-file='.length);
const suppliedEnv = envFile ? readEnvFile(path.resolve(root, envFile)) : {};
const releaseEnv = { ...process.env, ...suppliedEnv };
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';

const ciProductionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL:
    'postgresql://ci_user:ci_password@db.ci.internal:5432/meditrack_ci?schema=public',
  JWT_SECRET: 'ci-only-access-secret-not-used-outside-validation-1234567890',
  JWT_REFRESH_SECRET:
    'ci-only-refresh-secret-not-used-outside-validation-0987654321',
  API_BASE_URL: 'https://api.ci.example.test',
  FRONTEND_URL: 'https://app.ci.example.test',
  VITE_API_URL: 'https://api.ci.example.test/api',
  VITE_ENABLE_DEVTOOLS: 'false',
  MEDICAL_FILE_STORAGE: 'private-object',
  MEDICAL_FILE_STORAGE_BUCKET: 'ci-medical-files',
  EMAIL_VERIFICATION_ENABLED: 'true',
  EMAIL_VERIFICATION_PROVIDER: 'brevo',
  BREVO_API_KEY: 'ci-only-brevo-key',
  EMAIL_FROM_ADDRESS: 'verified-sender@ci.example.test',
};

console.log(
  `MediTrack release verification (${isCi ? 'CI' : 'production'} mode)`,
);

run(
  'Production environment contract',
  process.execPath,
  [
    path.join(root, 'tools', 'validate-production-env.mjs'),
    ...(isCi ? [] : ['--require-android-signing']),
    ...(envFile ? [`--env-file=${path.resolve(root, envFile)}`] : []),
  ],
  root,
  isCi ? ciProductionEnv : releaseEnv,
);

run('Prisma schema validation', npx, ['prisma', 'validate'], root, releaseEnv);
run(
  'Backend production dependency audit',
  npm,
  ['audit', '--omit=dev', '--audit-level=high'],
  root,
  releaseEnv,
);
run('Backend lint ratchet', npm, ['run', 'lint:ratchet'], root, releaseEnv);
run('Backend tests', npm, ['test', '--', '--runInBand'], root, releaseEnv);
run('Backend production build', npm, ['run', 'build'], root, releaseEnv);
run(
  'Frontend production dependency audit',
  process.execPath,
  [path.join(root, 'tools', 'audit-frontend-production.mjs')],
  root,
  releaseEnv,
);
run('Frontend lint ratchet', npm, ['run', 'lint:ratchet'], webRoot, releaseEnv);
run('Frontend typecheck', npm, ['run', 'typecheck'], webRoot, releaseEnv);
run(
  'Frontend production build',
  npm,
  ['run', 'build'],
  webRoot,
  isCi
    ? { ...releaseEnv, VITE_API_URL: ciProductionEnv.VITE_API_URL }
    : releaseEnv,
);

if (!skipAndroid) {
  assertJava21(releaseEnv);

  const androidEnv = isCi
    ? { ...releaseEnv, VITE_API_URL: ciProductionEnv.VITE_API_URL }
    : releaseEnv;

  if (!fs.existsSync(androidRoot)) {
    stop(
      'Android project is missing. Run `npm --prefix apps/web run cap:add:android` first.',
    );
  }

  run(
    'Android web asset build',
    npm,
    ['run', 'build:android'],
    webRoot,
    androidEnv,
  );
  run(
    'Capacitor Android sync',
    npx,
    ['cap', 'sync', 'android'],
    webRoot,
    androidEnv,
  );

  const gradleTasks = isCi
    ? ['--no-daemon', 'lintDebug', 'testDebugUnitTest', 'assembleDebug']
    : ['--no-daemon', 'lintRelease', 'testReleaseUnitTest', 'assembleRelease'];
  run(
    'Android Gradle verification',
    gradle,
    gradleTasks,
    androidRoot,
    androidEnv,
  );
}

console.log('\nAll release verification gates passed.');

function assertJava21(env) {
  const javaHome = env.JAVA_HOME;
  if (!javaHome) {
    stop('JAVA_HOME must point to JDK 21 before Android verification.');
  }

  const java = path.join(
    javaHome,
    'bin',
    process.platform === 'win32' ? 'java.exe' : 'java',
  );
  if (!fs.existsSync(java)) {
    stop(`JAVA_HOME does not contain a Java executable: ${javaHome}`);
  }

  const result = spawnSync(java, ['-version'], { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const version = output.match(/version "(\d+)/)?.[1];
  if (version !== '21') {
    stop(
      `Android verification requires JDK 21; JAVA_HOME is using Java ${version ?? 'unknown'}.`,
    );
  }
  console.log(`Android JDK preflight passed (${javaHome}).`);
}
function run(label, command, commandArgs, cwd, extraEnv) {
  const startedAt = Date.now();
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, commandArgs, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) stop(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0)
    stop(`${label} failed with exit code ${result.status}.`);
  console.log(
    `<== ${label} passed (${formatDuration(Date.now() - startedAt)})`,
  );
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) stop(`Environment file not found: ${filePath}`);
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
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

function formatDuration(milliseconds) {
  const seconds = Math.round(milliseconds / 1000);
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function stop(message) {
  console.error(`\nRelease verification stopped: ${message}`);
  process.exit(1);
}
