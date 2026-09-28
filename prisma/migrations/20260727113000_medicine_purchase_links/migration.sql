CREATE TABLE "medicine_purchase_links" (
    "id" TEXT NOT NULL,
    "medicineMasterId" TEXT NOT NULL,
    "medicinePackageId" TEXT,
    "provider" TEXT NOT NULL,
    "productUrl" TEXT NOT NULL,
    "providerProductId" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" "RecordSource" NOT NULL DEFAULT 'IMPORT',
    "verifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_purchase_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "medicine_purchase_links_provider_productUrl_key"
ON "medicine_purchase_links"("provider", "productUrl");

CREATE INDEX "medicine_purchase_links_medicineMasterId_isActive_isVerified_idx"
ON "medicine_purchase_links"("medicineMasterId", "isActive", "isVerified");

CREATE INDEX "medicine_purchase_links_medicinePackageId_isActive_isVerified_idx"
ON "medicine_purchase_links"("medicinePackageId", "isActive", "isVerified");

CREATE INDEX "medicine_purchase_links_provider_providerProductId_idx"
ON "medicine_purchase_links"("provider", "providerProductId");

ALTER TABLE "medicine_purchase_links"
ADD CONSTRAINT "medicine_purchase_links_medicineMasterId_fkey"
FOREIGN KEY ("medicineMasterId") REFERENCES "medicine_masters"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "medicine_purchase_links"
ADD CONSTRAINT "medicine_purchase_links_medicinePackageId_fkey"
FOREIGN KEY ("medicinePackageId") REFERENCES "medicine_packages"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
