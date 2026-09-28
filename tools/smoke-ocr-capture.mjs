import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const options = parseArgs(process.argv.slice(2));
const serviceUrl = (options['ocr-url'] ?? process.env.OCR_SERVICE_URL ?? '')
  .trim()
  .replace(/\/$/, '');
const token = (options.token ?? process.env.OCR_SERVICE_TOKEN ?? '').trim();
const documentType = (options['document-type'] ?? 'package')
  .trim()
  .toLowerCase();
const filePath = options.file ? resolve(options.file) : '';

if (!serviceUrl || !filePath) {
  fail(
    'Usage: npm run smoke:ocr -- --ocr-url <url> --file <image> ' +
      '[--document-type package|bill|prescription] [--token <token>]',
  );
}
if (!existsSync(filePath)) fail(`Image not found: ${filePath}`);
if (!['package', 'bill', 'prescription', 'generic'].includes(documentType)) {
  fail(`Unsupported document type: ${documentType}`);
}

console.log('MediTrack OCR smoke check (text-safe)');
console.log(`Service: ${serviceUrl}`);
console.log(`Document: ${documentType}`);
console.log(`File: ${basename(filePath)}`);

const ready = await request(`${serviceUrl}/health/ready`, {
  timeoutMs: 180_000,
});
if (!ready.ok) fail(`OCR readiness failed (${ready.status}): ${ready.error}`);
console.log(
  `PASS OCR model readiness (${ready.status}, ${ready.durationMs} ms)`,
);

const form = new FormData();
form.append(
  'file',
  new Blob([readFileSync(filePath)], { type: contentType(filePath) }),
  basename(filePath),
);
form.append('documentType', documentType);

const headers = token ? { 'X-OCR-Service-Token': token } : {};
const result = await request(`${serviceUrl}/ocr`, {
  method: 'POST',
  headers,
  body: form,
  timeoutMs: 180_000,
});
if (!result.ok) fail(`OCR request failed (${result.status}): ${result.error}`);

const payload = result.body ?? {};
const summary = {
  success: payload.success === true,
  source: payload.source ?? 'NO_RESULT',
  modelVersion: payload.modelVersion ?? null,
  selectedVariant: payload.selectedVariant ?? null,
  averageConfidence: payload.avgConfidence ?? 0,
  wordCount: payload.wordsCount ?? 0,
  lineCount: Array.isArray(payload.lines) ? payload.lines.length : 0,
  qualityScore: payload.quality?.score ?? 0,
  fallbackReason: payload.fallbackReason ?? null,
  processingMs: payload.processingMs ?? result.durationMs,
};
console.log(JSON.stringify(summary, null, 2));

if (options['show-lines'] === 'true' && Array.isArray(payload.lines)) {
  console.table(
    payload.lines.map((line, index) => ({
      line: index + 1,
      confidence: Math.round(Number(line.confidence ?? 0) * 100) / 100,
      text: String(line.text ?? '').replace(/\s+/g, ' ').trim(),
    })),
  );
}

if (!summary.success || summary.source !== 'SERVER_OCR') {
  fail(
    'OCR returned no safe result. Retake/preprocess the image; do not save inferred data.',
  );
}
console.log(
  options['show-lines'] === 'true'
    ? 'OCR smoke check passed. Diagnostic lines were explicitly enabled.'
    : 'OCR smoke check passed. Recognized text was intentionally not printed.',
);

async function request(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    init.timeoutMs ?? 30_000,
  );
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const raw = await response.text();
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      body,
      error: body?.detail ?? body?.message ?? raw.slice(0, 160),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index++) {
    const current = args[index];
    if (!current.startsWith('--')) continue;
    const [rawName, inlineValue] = current.slice(2).split('=', 2);
    const value = inlineValue ?? args[index + 1];
    if (inlineValue === undefined) index++;
    parsed[rawName] = value ?? '';
  }
  return parsed;
}

function contentType(value) {
  const lower = value.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
