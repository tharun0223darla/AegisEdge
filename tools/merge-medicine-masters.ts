import { PrismaClient } from '@prisma/client';
import { MedicineMasterMergeEngine } from '../src/medicines/import/medicine-master-merge.engine';

interface CliArgs {
  commit: boolean;
  limit?: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { commit: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--commit') {
      args.commit = true;
    } else if (arg === '--limit') {
      args.limit = Number(next);
      index += 1;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const engine = new MedicineMasterMergeEngine(prisma);

  try {
    const summary = await engine.mergeDuplicates({
      dryRun: !args.commit,
      limit: args.limit,
    });

    console.log(
      JSON.stringify(
        {
          ...summary,
          groups: summary.groups.map((group) => ({
            identityKey: group.identityKey,
            winner: group.winner,
            losers: group.losers,
          })),
        },
        null,
        2,
      ),
    );

    if (!args.commit && summary.groupsFound > 0) {
      console.log('');
      console.log('Dry run only. Re-run with --commit to archive losers and repoint references.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
