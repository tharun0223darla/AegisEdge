import { existsSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { MedicineImportEngine } from '../src/medicines/import/medicine-import.engine';

interface CliArgs {
  file?: string;
  batchId?: string;
  dataset?: string;
  version?: string;
  commit: boolean;
  batchSize?: number;
  maxRows?: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { commit: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--commit') {
      args.commit = true;
    } else if (arg === '--batch-id') {
      args.batchId = next;
      index += 1;
    } else if (arg === '--file') {
      args.file = next;
      index += 1;
    } else if (arg === '--dataset') {
      args.dataset = next;
      index += 1;
    } else if (arg === '--version') {
      args.version = next;
      index += 1;
    } else if (arg === '--batch-size') {
      args.batchSize = Number(next);
      index += 1;
    } else if (arg === '--max-rows') {
      args.maxRows = Number(next);
      index += 1;
    }
  }

  return args;
}

function printUsage() {
  console.log(
    [
      'Usage:',
      '  npm run import:medicines -- --file ./data/medicines.csv --dataset indian-master --version 2026-06 --commit',
      '  npm run import:medicines -- --batch-id <staged-batch-id> --commit --batch-size 50',
      '',
      'Without --commit, the file is staged and previewed only.',
      'With --batch-id, an existing staged/failed batch is previewed or resumed without reading the CSV again.',
      'Use --max-rows 1000 to sample a large CSV before staging the whole file.',
      'CSV headers accepted: brandName/name, composition/salt, manufacturer, strength, type, packSize, gtin, stripImageUrl, pillImageUrl.',
    ].join('\n'),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.file && !args.batchId) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  const engine = new MedicineImportEngine(prisma);

  try {
    if (args.batchId) {
      const preview = await engine.preview(args.batchId);
      console.log(`Existing batch: ${preview.batch.id}`);
      console.log(`Rows: ${preview.batch.totalRows}`);
      console.log(`Status: ${preview.batch.status}`);
      console.log(`Actions: ${JSON.stringify(preview.actionCounts)}`);
      console.log(
        `Salts: create=${preview.batch.saltsToCreate}, reuse=${preview.batch.saltsToReuse}`,
      );

      if (!args.commit) {
        console.log('Preview only. Re-run with --commit to resume this batch.');
        return;
      }

      const result = await engine.commit(preview.batch.id, {
        batchSize: args.batchSize,
        onProgress: (progress) => {
          console.log(
            `Progress: processed=${progress.processedRows}, committed=${progress.committedRows}, skipped=${progress.skippedRows}, pending=${progress.pendingRows}`,
          );
        },
      });
      console.log(`Committed batch: ${result.batchId}`);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const filePath = resolve(args.file!);
    if (!existsSync(filePath)) {
      throw new Error(`Import file not found: ${filePath}`);
    }

    const preview = await engine.ingestCsv({
      filePath,
      originalFileName: args.file,
      datasetName: args.dataset,
      datasetVersion: args.version,
      maxRows: args.maxRows,
    });

    console.log(`Staged batch: ${preview.batch.id}`);
    console.log(`Rows: ${preview.batch.totalRows}`);
    console.log(`Actions: ${JSON.stringify(preview.actionCounts)}`);
    console.log(
      `Salts: create=${preview.batch.saltsToCreate}, reuse=${preview.batch.saltsToReuse}`,
    );

    if (!args.commit) {
      console.log('Preview only. Re-run with --commit to write valid rows.');
      return;
    }

    const result = await engine.commit(preview.batch.id, {
      batchSize: args.batchSize,
      onProgress: (progress) => {
        console.log(
          `Progress: processed=${progress.processedRows}, committed=${progress.committedRows}, skipped=${progress.skippedRows}, pending=${progress.pendingRows}`,
        );
      },
    });
    console.log(`Committed batch: ${result.batchId}`);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
