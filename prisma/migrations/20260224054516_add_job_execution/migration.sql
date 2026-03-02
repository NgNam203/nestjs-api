-- CreateEnum
CREATE TYPE "JobExecutionStatus" AS ENUM ('PROCESSING', 'COMPLETED');

-- CreateTable
CREATE TABLE "job_executions" (
    "id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "status" "JobExecutionStatus" NOT NULL DEFAULT 'PROCESSING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_executions_idempotency_key_key" ON "job_executions"("idempotency_key");

-- CreateIndex
CREATE INDEX "job_executions_status_idx" ON "job_executions"("status");
