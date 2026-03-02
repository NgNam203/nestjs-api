/*
  Warnings:

  - A unique constraint covering the columns `[user_id,client_request_id]` on the table `orders` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `client_request_id` to the `orders` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "orders_status_created_at_idx";

-- DropIndex
DROP INDEX "orders_user_id_created_at_idx";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "client_request_id" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_id_idx" ON "orders"("user_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "orders_user_id_client_request_id_key" ON "orders"("user_id", "client_request_id");
