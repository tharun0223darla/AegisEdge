import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function printHelp() {
  console.log(`Usage:
  npm run admin:promote -- --email user@example.com

Promotes an existing trusted account to ADMIN. Public registration cannot create admin accounts.`);
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  const email = argValue('--email')?.trim().toLowerCase();

  if (!email) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.update({
    where: { email },
    data: { role: UserRole.ADMIN, isActive: true },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      updatedAt: true,
    },
  });

  console.log(JSON.stringify({ promoted: true, user }, null, 2));
}

main()
  .catch((error) => {
    if (error?.code === 'P2025') {
      console.error('No user found with that email. Create the account first, then run this command again.');
    } else {
      console.error(error);
    }

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });