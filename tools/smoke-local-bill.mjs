import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { PrismaClient, UserRole } from '@prisma/client';

dotenv.config({ quiet: true });

const options = parseArgs(process.argv.slice(2));
if (!options.file) {
  fail('Usage: npm run smoke:bill:local -- --file <bill.jpg> [--expect-rows 4]');
}

const filePath = resolve(options.file);
if (!existsSync(filePath)) fail(`Bill file not found: ${filePath}`);

const apiUrl = (options.apiUrl || 'http://localhost:3001/api').replace(/\/$/, '');
const expectedRows = options.expectRows ? Number(options.expectRows) : null;
const prisma = new PrismaClient();
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = `bill-smoke-${runId}@example.test`;
const password = `BillSmoke@${runId}`;
let userId;
let accessToken;
let billId;

try {
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: UserRole.PATIENT,
      isActive: true,
      isVerified: true,
    },
    select: { id: true },
  });
  userId = user.id;

  const login = await fetchJson(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  accessToken = login.data?.accessToken;
  if (!accessToken) fail('Local login did not return an access token.');

  const form = new FormData();
  const bytes = readFileSync(filePath);
  form.append(
    'file',
    new Blob([bytes], { type: mimeType(filePath) }),
    basename(filePath),
  );

  const upload = await fetchJson(`${apiUrl}/bills/upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  const result = upload.data;
  billId = result?.bill?.id;
  const candidates = result?.billCandidates ?? [];

  console.log('MediTrack local bill acceptance check');
  console.log(`OCR engine: ${result?.ocr?.engine ?? 'unknown'}`);
  console.log(`Candidates: ${candidates.length}`);
  console.table(
    candidates.map((candidate, index) => ({
      row: index + 1,
      medicine: candidate.rawName,
      strength: candidate.extractedStrength ?? '',
      pack: candidate.extractedPack ?? '',
      quantity: candidate.quantity ?? '',
      match: candidate.resolverOutcome?.kind ?? 'UNKNOWN',
    })),
  );

  if (expectedRows !== null && candidates.length !== expectedRows) {
    fail(`Expected ${expectedRows} medicine rows, received ${candidates.length}.`);
  }

  console.log('PASS Authenticated bill upload completed without confirming or saving stock.');
} finally {
  if (billId && accessToken) {
    await fetch(`${apiUrl}/bills/${billId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` },
    }).catch(() => undefined);
  }
  if (userId) {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    fail(`${init.method ?? 'GET'} ${url} failed with HTTP ${response.status}.`);
  }
  return body;
}

function mimeType(path) {
  const extension = extname(path).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.pdf') return 'application/pdf';
  return 'image/jpeg';
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--file') result.file = args[++index];
    else if (arg === '--api-url') result.apiUrl = args[++index];
    else if (arg === '--expect-rows') result.expectRows = args[++index];
  }
  return result;
}

function fail(message) {
  throw new Error(message);
}
