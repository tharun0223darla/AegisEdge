import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { PrismaClient, UserRole } from '@prisma/client';

dotenv.config({ quiet: true });

const options = parseArgs(process.argv.slice(2));
if (!options.file) {
  fail(
    'Usage: npm run smoke:package:local -- --file <package.jpg> ' +
      '[--expect-name "Brand"]',
  );
}

const filePath = resolve(options.file);
if (!existsSync(filePath)) fail(`Package file not found: ${filePath}`);

const apiUrl = (options.apiUrl || 'http://localhost:3001/api').replace(/\/$/, '');
const prisma = new PrismaClient();
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = `package-smoke-${runId}@example.test`;
const password = `PackageSmoke@${runId}`;
let userId;
let storedName;

try {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 10),
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
  const accessToken = login.data?.accessToken;
  if (!accessToken) fail('Local login did not return an access token.');

  const form = new FormData();
  form.append(
    'file',
    new Blob([readFileSync(filePath)], { type: mimeType(filePath) }),
    basename(filePath),
  );

  const response = await fetchJson(`${apiUrl}/medicines/package-image/capture`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  const result = response.data;
  storedName = result?.image?.storedName;

  console.log('MediTrack local package acceptance check');
  console.log(
    JSON.stringify(
      {
        ocrSource: result?.ocr?.source ?? 'NO_RESULT',
        ocrConfidence: result?.ocr?.confidence ?? 0,
        medicine: result?.candidate?.rawName ?? null,
        strength: result?.candidate?.extractedStrength ?? null,
        pack: result?.candidate?.extractedPack ?? null,
        composition: result?.candidate?.composition?.displayName ?? null,
        match: result?.candidate?.resolverOutcome?.kind ?? 'UNKNOWN',
        matchedMaster:
          result?.candidate?.masterMatches?.[0]?.brandName ?? null,
        matchScore: result?.candidate?.masterMatches?.[0]?.score ?? 0,
        matchReason: result?.candidate?.masterMatches?.[0]?.matchReason ?? null,
        reviewRequired: result?.reviewRequired ?? true,
      },
      null,
      2,
    ),
  );

  if (!result?.candidate) fail('No safe package candidate was extracted.');
  if (
    options.expectName &&
    normalize(result.candidate.rawName) !== normalize(options.expectName)
  ) {
    fail(
      `Expected package name "${options.expectName}", received ` +
        `"${result.candidate.rawName}".`,
    );
  }

  console.log('PASS Package candidate requires confirmation and was not saved.');
} finally {
  if (storedName && !/[\\/]/.test(storedName)) {
    try {
      unlinkSync(join(process.cwd(), 'uploads', 'package-images', storedName));
    } catch {
      // The capture endpoint may already have cleaned up a rejected upload.
    }
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

function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function mimeType(path) {
  return extname(path).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--file') result.file = args[++index];
    else if (arg === '--api-url') result.apiUrl = args[++index];
    else if (arg === '--expect-name') result.expectName = args[++index];
  }
  return result;
}

function fail(message) {
  throw new Error(message);
}
