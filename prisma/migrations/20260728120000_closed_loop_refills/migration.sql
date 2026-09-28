-- Closed-loop refill lifecycle and append-only inventory history.
CREATE TYPE "RefillOrderStatus" AS ENUM ('ORDERED', 'RECEIVED', 'CANCELLED');
CREATE TYPE "InventoryEventType" AS ENUM ('REFILL_RECEIVED', 'MANUAL_CORRECTION');
CREATE TYPE "StockAlertLevel" AS ENUM ('LOW', 'CRITICAL', 'OUT');

ALTER TABLE "medicines"
ADD COLUMN "lastStockAlertLevel" "StockAlertLevel",
ADD COLUMN "lastStockAlertAt" TIMESTAMP(3);

CREATE TABLE "refill_orders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "status" "RefillOrderStatus" NOT NULL DEFAULT 'ORDERED',
    "provider" TEXT,
    "expectedQuantity" INTEGER,
    "receivedQuantity" INTEGER,
    "externalReference" TEXT,
    "notes" TEXT,
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "refill_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "medicine_inventory_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "type" "InventoryEventType" NOT NULL,
    "delta" INTEGER NOT NULL,
    "quantityBefore" INTEGER,
    "quantityAfter" INTEGER NOT NULL,
    "reason" TEXT,
    "sourceReference" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "medicine_inventory_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refill_orders_userId_idempotencyKey_key" ON "refill_orders"("userId", "idempotencyKey");
CREATE INDEX "refill_orders_userId_status_orderedAt_idx" ON "refill_orders"("userId", "status", "orderedAt");
CREATE INDEX "refill_orders_medicineId_status_idx" ON "refill_orders"("medicineId", "status");
CREATE UNIQUE INDEX "refill_orders_one_pending_per_medicine_idx" ON "refill_orders"("userId", "medicineId") WHERE "status" = 'ORDERED';
CREATE UNIQUE INDEX "medicine_inventory_events_userId_idempotencyKey_key" ON "medicine_inventory_events"("userId", "idempotencyKey");
CREATE INDEX "medicine_inventory_events_userId_createdAt_idx" ON "medicine_inventory_events"("userId", "createdAt");
CREATE INDEX "medicine_inventory_events_medicineId_createdAt_idx" ON "medicine_inventory_events"("medicineId", "createdAt");

ALTER TABLE "refill_orders" ADD CONSTRAINT "refill_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refill_orders" ADD CONSTRAINT "refill_orders_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "medicines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medicine_inventory_events" ADD CONSTRAINT "medicine_inventory_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medicine_inventory_events" ADD CONSTRAINT "medicine_inventory_events_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "medicines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
