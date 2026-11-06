-- Carteira de investimentos: apenas acrescenta colunas anuláveis e tabelas novas.
-- Nenhuma coluna ou linha existente é alterada ou removida (migration não destrutiva).

-- AlterTable
ALTER TABLE "CardCatalog" ADD COLUMN     "pricesCheckedAt" TIMESTAMP(3),
ADD COLUMN     "pricesErrorAt" TIMESTAMP(3),
ADD COLUMN     "pricesStatus" TEXT;

-- AlterTable
ALTER TABLE "CollectionItem" ADD COLUMN     "manualValueAt" TIMESTAMP(3),
ADD COLUMN     "manualValueCents" INTEGER,
ADD COLUMN     "purchaseFxDate" DATE,
ADD COLUMN     "purchaseFxRate" DECIMAL(18,8);

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "feesCents" INTEGER;

-- CreateTable
CREATE TABLE "CardPriceSnapshot" (
    "id" TEXT NOT NULL,
    "cardCatalogId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "marketPrice" DECIMAL(14,4) NOT NULL,
    "priceField" TEXT NOT NULL,
    "priceBRL" DECIMAL(14,2) NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL,
    "exchangeRateDate" DATE NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedOn" DATE NOT NULL,

    CONSTRAINT "CardPriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "rateDate" DATE NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "CardPriceSnapshot_provider_capturedOn_idx" ON "CardPriceSnapshot"("provider", "capturedOn");

-- CreateIndex
CREATE UNIQUE INDEX "CardPriceSnapshot_cardCatalogId_provider_variant_capturedOn_key" ON "CardPriceSnapshot"("cardCatalogId", "provider", "variant", "capturedOn");

-- CreateIndex
CREATE INDEX "ExchangeRate_base_quote_fetchedAt_idx" ON "ExchangeRate"("base", "quote", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_base_quote_rateDate_key" ON "ExchangeRate"("base", "quote", "rateDate");

-- AddForeignKey
ALTER TABLE "CardPriceSnapshot" ADD CONSTRAINT "CardPriceSnapshot_cardCatalogId_fkey" FOREIGN KEY ("cardCatalogId") REFERENCES "CardCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
