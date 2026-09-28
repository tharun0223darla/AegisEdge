import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  isAllowedPharmacyProductUrl,
  isPharmacyProvider,
} from '../src/refills/pharmacy-provider.config';
import { SaltCanonicalizer } from '../src/medicines/import/salt-canonicalizer';

interface CliArgs {
  file?: string;
  commit: boolean;
}

const manifestSchema = z.array(
  z.object({
    brandName: z.string().trim().min(1),
    manufacturer: z.string().trim().min(1).optional(),
    packSize: z.string().trim().min(1).optional(),
    provider: z.string().trim().min(1),
    productUrl: z.string().url(),
    providerProductId: z.string().trim().min(1).optional(),
  }),
);

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { commit: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--commit') {
      args.commit = true;
    } else if (arg === '--file') {
      args.file = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function normalize(value?: string | null): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function usage(): void {
  console.log(
    [
      'Usage:',
      '  npm run import:purchase-links -- --file ./data/purchase-links.json',
      '  npm run import:purchase-links -- --file ./data/purchase-links.json --commit',
      '',
      'Dry-run is the default. Only reviewed HTTPS product URLs on supported pharmacy domains are accepted.',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    usage();
    process.exitCode = 1;
    return;
  }

  const filePath = resolve(args.file);
  if (!existsSync(filePath)) {
    throw new Error(`Purchase-link manifest not found: ${filePath}`);
  }

  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(filePath, 'utf8')) as unknown,
  );
  const prisma = new PrismaClient();
  const canonicalizer = new SaltCanonicalizer();
  const report = {
    total: manifest.length,
    ready: 0,
    created: 0,
    updated: 0,
    rejected: 0,
    dryRun: !args.commit,
    rows: [] as Array<Record<string, unknown>>,
  };

  try {
    for (const [index, row] of manifest.entries()) {
      const rowNumber = index + 1;
      if (
        !isPharmacyProvider(row.provider) ||
        !isAllowedPharmacyProductUrl(row.provider, row.productUrl)
      ) {
        report.rejected += 1;
        report.rows.push({
          row: rowNumber,
          status: 'REJECTED',
          reason: 'Unsupported provider or product URL domain.',
        });
        continue;
      }

      const candidates = await prisma.medicineMaster.findMany({
        where: {
          brandName: { equals: row.brandName, mode: 'insensitive' },
          isArchived: false,
        },
        select: {
          id: true,
          brandName: true,
          manufacturer: true,
          packages: {
            where: { isDemo: false },
            select: {
              id: true,
              packSize: true,
            },
          },
        },
      });
      const matchingMasters = row.manufacturer
        ? candidates.filter(
            (candidate) =>
              normalize(candidate.manufacturer) === normalize(row.manufacturer),
          )
        : candidates;

      if (matchingMasters.length !== 1) {
        report.rejected += 1;
        report.rows.push({
          row: rowNumber,
          status: 'REJECTED',
          reason:
            matchingMasters.length === 0
              ? 'No exact medicine master match.'
              : 'Ambiguous medicine master match; add manufacturer.',
        });
        continue;
      }

      const master = matchingMasters[0];
      let medicinePackageId: string | null = null;
      if (row.packSize) {
        const targetPack = canonicalizer.normalizePackSize(row.packSize);
        const packages = master.packages.filter(
          (item) =>
            canonicalizer.normalizePackSize(item.packSize) === targetPack,
        );
        if (packages.length !== 1) {
          report.rejected += 1;
          report.rows.push({
            row: rowNumber,
            status: 'REJECTED',
            reason:
              packages.length === 0
                ? 'No exact non-demo package match.'
                : 'Ambiguous package match.',
          });
          continue;
        }
        medicinePackageId = packages[0].id;
      }

      const existing = await prisma.medicinePurchaseLink.findUnique({
        where: {
          provider_productUrl: {
            provider: row.provider,
            productUrl: row.productUrl,
          },
        },
        select: {
          id: true,
          medicineMasterId: true,
          medicinePackageId: true,
        },
      });

      if (
        existing &&
        (existing.medicineMasterId !== master.id ||
          existing.medicinePackageId !== medicinePackageId)
      ) {
        report.rejected += 1;
        report.rows.push({
          row: rowNumber,
          status: 'REJECTED',
          reason:
            'Existing verified URL points to a different medicine or pack.',
        });
        continue;
      }

      report.ready += 1;
      report.rows.push({
        row: rowNumber,
        status: existing ? 'UPDATE' : 'CREATE',
        brandName: master.brandName,
        provider: row.provider,
        packSize: row.packSize ?? null,
      });

      if (!args.commit) continue;

      const now = new Date();
      await prisma.medicinePurchaseLink.upsert({
        where: {
          provider_productUrl: {
            provider: row.provider,
            productUrl: row.productUrl,
          },
        },
        create: {
          medicineMasterId: master.id,
          medicinePackageId,
          provider: row.provider,
          productUrl: row.productUrl,
          providerProductId: row.providerProductId,
          isVerified: true,
          isActive: true,
          source: 'ADMIN',
          verifiedAt: now,
          lastCheckedAt: now,
        },
        update: {
          providerProductId: row.providerProductId,
          isVerified: true,
          isActive: true,
          source: 'ADMIN',
          verifiedAt: existing ? undefined : now,
          lastCheckedAt: now,
        },
      });
      if (existing) report.updated += 1;
      else report.created += 1;
    }

    console.log(JSON.stringify(report, null, 2));
    if (!args.commit && report.ready > 0) {
      console.log(
        'Preview only. Re-run with --commit after reviewing every row.',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
