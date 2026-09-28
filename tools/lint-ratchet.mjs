import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectArg = process.argv.find((value) => value.startsWith('--project='));
const project = projectArg?.slice('--project='.length);
const writeBaseline = process.argv.includes('--write-baseline');

if (!['backend', 'web'].includes(project)) {
  stop('Use --project=backend or --project=web.');
}

const config =
  project === 'backend'
    ? {
        cwd: root,
        args: ['{src,test}/**/*.ts'],
        baseline: path.join(root, 'config', 'eslint-baseline-backend.json'),
      }
    : {
        cwd: path.join(root, 'apps', 'web'),
        args: ['.'],
        baseline: path.join(root, 'config', 'eslint-baseline-web.json'),
      };

const eslintBin = path.join(
  config.cwd,
  'node_modules',
  'eslint',
  'bin',
  'eslint.js',
);

if (!fs.existsSync(eslintBin)) {
  stop(`ESLint is not installed for ${project}. Run npm ci first.`);
}

const result = spawnSync(
  process.execPath,
  [eslintBin, ...config.args, '--format', 'json'],
  {
    cwd: config.cwd,
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
  },
);

if (result.error) stop(`ESLint could not start: ${result.error.message}`);
if (!result.stdout.trim()) {
  stop(result.stderr.trim() || 'ESLint returned no JSON report.');
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  stop(`Could not parse ESLint JSON output: ${result.stderr.trim()}`);
}

const current = buildCounts(report, config.cwd);
const totals = summarize(current);

if (writeBaseline) {
  fs.mkdirSync(path.dirname(config.baseline), { recursive: true });
  fs.writeFileSync(
    config.baseline,
    `${JSON.stringify({ version: 1, project, violations: current }, null, 2)}\n`,
  );
  console.log(
    `Wrote ${project} ESLint baseline: ${totals.total} violations across ${totals.files} files.`,
  );
  process.exit(0);
}

if (!fs.existsSync(config.baseline)) {
  stop(
    `Missing baseline ${path.relative(root, config.baseline)}. Generate it with --write-baseline.`,
  );
}

const baselineDocument = JSON.parse(fs.readFileSync(config.baseline, 'utf8'));
const baseline = baselineDocument.violations ?? {};
const regressions = [];

for (const [file, rules] of Object.entries(current)) {
  for (const [rule, count] of Object.entries(rules)) {
    const allowed = baseline[file]?.[rule] ?? 0;
    if (count > allowed) {
      regressions.push({ file, rule, allowed, current: count });
    }
  }
}

if (regressions.length > 0) {
  console.error(`New ${project} ESLint violations:`);
  for (const regression of regressions.slice(0, 50)) {
    console.error(
      `- ${regression.file}: ${regression.rule} ${regression.current} (baseline ${regression.allowed})`,
    );
  }
  if (regressions.length > 50) {
    console.error(`- ...and ${regressions.length - 50} more`);
  }
  stop('Lint ratchet failed. Fix new violations; do not expand the baseline.');
}

const baselineTotals = summarize(baseline);
console.log(
  `${project} lint ratchet passed: ${totals.total} current violations ` +
    `(baseline ${baselineTotals.total}; no per-file rule increased).`,
);

function buildCounts(results, cwd) {
  const counts = {};
  for (const fileResult of results) {
    const relative = path
      .relative(cwd, fileResult.filePath)
      .split(path.sep)
      .join('/');
    const fileCounts = {};
    for (const message of fileResult.messages) {
      const rule = message.ruleId ?? '<fatal>';
      fileCounts[rule] = (fileCounts[rule] ?? 0) + 1;
    }
    if (Object.keys(fileCounts).length > 0) {
      counts[relative] = Object.fromEntries(
        Object.entries(fileCounts).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      );
    }
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function summarize(counts) {
  const files = Object.keys(counts).length;
  const total = Object.values(counts).reduce(
    (fileTotal, rules) =>
      fileTotal + Object.values(rules).reduce((sum, count) => sum + count, 0),
    0,
  );
  return { files, total };
}

function stop(message) {
  console.error(message);
  process.exit(1);
}
