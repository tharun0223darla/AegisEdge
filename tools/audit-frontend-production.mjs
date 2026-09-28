import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(root, 'apps', 'web');
const advisoryId = 'GHSA-qwww-vcr4-c8h2';
const exceptionExpiresAt = new Date('2026-09-15T00:00:00.000Z');
const allowedVersion = '7.18.1';
const validateOnly = process.argv.includes('--validate-exception');
const selfTest = process.argv.includes('--self-test');

if (selfTest) {
  runSelfTest();
  process.exit(0);
}

if (validateOnly) {
  validateExceptionPreconditions();
  console.log('Frontend audit exception preconditions passed.');
  process.exit(0);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const audit = spawnSync(
  npm,
  ['audit', '--omit=dev', '--audit-level=high'],
  {
    cwd: webRoot,
    encoding: 'utf8',
    env: process.env,
    shell: process.platform === 'win32',
  },
);

const output = `${audit.stdout ?? ''}${audit.stderr ?? ''}`;
process.stdout.write(output);

if (audit.status === 0) {
  process.exit(0);
}

if (audit.error) {
  console.error(`Frontend dependency audit could not run: ${audit.error.message}`);
  process.exit(1);
}

validateExceptionPreconditions();

if (!isAllowedAuditOutput(output)) {
  console.error(
    'Frontend audit failed with a vulnerability outside the approved React Router RSC-only exception.',
  );
  process.exit(1);
}

console.warn(
  `Accepted temporary exception for ${advisoryId}: MediTrack does not use React Router unstable RSC APIs. Exception expires ${exceptionExpiresAt.toISOString().slice(0, 10)}.`,
);

function isAllowedAuditOutput(auditOutput) {
  const advisoryIds = [
    ...new Set(
      auditOutput.match(/GHSA-[a-z0-9-]+/gi)?.map((id) => id.toLowerCase()) ?? [],
    ),
  ];
  const highOrCriticalSections = auditOutput
    .split(/\r?\n\r?\n/)
    .filter((section) => /Severity:\s*(high|critical)/i.test(section));
  const allowedId = advisoryId.toLowerCase();
  return (
    advisoryIds.length === 1 &&
    advisoryIds[0] === allowedId &&
    highOrCriticalSections.length > 0 &&
    highOrCriticalSections.every(
      (section) =>
        section.toLowerCase().includes(allowedId) &&
        /\breact-router(?:-dom)?\b/i.test(section),
    )
  );
}

function runSelfTest() {
  const allowed = `# npm audit report
react-router  7.12.0 - 8.2.0
Severity: high
RSC issue - https://github.com/advisories/${advisoryId}
node_modules/react-router`;
  const unrelated = `${allowed}

axios
Severity: high
Request issue - https://github.com/advisories/GHSA-aaaa-bbbb-cccc`;
  const criticalWithoutAdvisory = `${allowed}

unknown-package
Severity: critical
No advisory identifier`;
  if (!isAllowedAuditOutput(allowed)) {
    throw new Error('Audit policy self-test rejected the approved advisory.');
  }
  if (
    isAllowedAuditOutput(unrelated) ||
    isAllowedAuditOutput(criticalWithoutAdvisory)
  ) {
    throw new Error('Audit policy self-test accepted an unrelated vulnerability.');
  }
  console.log('Frontend audit policy self-test passed.');
}

function validateExceptionPreconditions() {
  if (Date.now() >= exceptionExpiresAt.getTime()) {
    throw new Error(
      `Security exception ${advisoryId} expired on ${exceptionExpiresAt.toISOString().slice(0, 10)}.`,
    );
  }

  const lock = JSON.parse(
    fs.readFileSync(path.join(webRoot, 'package-lock.json'), 'utf8'),
  );
  const installedVersion = lock.packages?.['node_modules/react-router']?.version;
  if (installedVersion !== allowedVersion) {
    throw new Error(
      `Security exception ${advisoryId} is approved only for react-router ${allowedVersion}; found ${installedVersion ?? 'unknown'}.`,
    );
  }

  const forbiddenRscMarkers = [
    'react-router-dom/server',
    'react-router/dom',
    'createRequestHandler',
    'RSCHydratedRouter',
    'RSCStaticRouter',
    'unstable_RSC',
    'react-server-dom-',
    "'use server'",
    '"use server"',
  ];
  const sourceFiles = listSourceFiles(path.join(webRoot, 'src'));
  for (const sourceFile of sourceFiles) {
    const source = fs.readFileSync(sourceFile, 'utf8');
    const marker = forbiddenRscMarkers.find((candidate) => source.includes(candidate));
    if (marker) {
      throw new Error(
        `Security exception ${advisoryId} is invalid because ${path.relative(root, sourceFile)} contains RSC marker "${marker}".`,
      );
    }
  }
}

function listSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(fullPath);
    }
    return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [fullPath] : [];
  });
}
