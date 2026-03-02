-- AlterTable
ALTER TABLE "job_executions" ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
