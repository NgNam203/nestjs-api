-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "orders_user_id_deleted_at_idx" ON "orders"("user_id", "deleted_at");
