import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });
async function main() {
  const keepDays = Number(process.env.JOB_EXEC_KEEP_DAYS ?? 7);
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000);

  const deleted = await prisma.jobExecution.deleteMany({
    where: {
      status: 'COMPLETED',
      completedAt: { lt: cutoff },
    },
  });

  console.log(
    JSON.stringify({
      event: 'job_execution_cleanup_done',
      keepDays,
      deleted: deleted.count,
      cutoff: cutoff.toISOString(),
    }),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
