-- CreateTable
CREATE TABLE "CardCatalog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "localNumber" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "setName" TEXT NOT NULL,
    "rarity" TEXT,
    "imageUrl" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CollectionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cardCatalogId" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "acquiredAt" DATETIME,
    "purchasePriceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CollectionItem_cardCatalogId_fkey" FOREIGN KEY ("cardCatalogId") REFERENCES "CardCatalog" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionItemId" TEXT NOT NULL,
    "soldAt" DATETIME NOT NULL,
    "salePriceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "notes" TEXT,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Sale_collectionItemId_fkey" FOREIGN KEY ("collectionItemId") REFERENCES "CollectionItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CardCatalog_name_idx" ON "CardCatalog"("name");

-- CreateIndex
CREATE INDEX "CardCatalog_setId_idx" ON "CardCatalog"("setId");

-- CreateIndex
CREATE UNIQUE INDEX "CardCatalog_provider_externalId_key" ON "CardCatalog"("provider", "externalId");

-- CreateIndex
CREATE INDEX "CollectionItem_cardCatalogId_idx" ON "CollectionItem"("cardCatalogId");

-- CreateIndex
CREATE INDEX "CollectionItem_status_idx" ON "CollectionItem"("status");

-- CreateIndex
CREATE INDEX "Sale_collectionItemId_idx" ON "Sale"("collectionItemId");

-- CreateIndex
CREATE INDEX "Sale_soldAt_idx" ON "Sale"("soldAt");

-- Impede duas vendas ativas (não canceladas) para o mesmo exemplar.
CREATE UNIQUE INDEX "Sale_one_active_per_item" ON "Sale"("collectionItemId") WHERE "cancelledAt" IS NULL;
