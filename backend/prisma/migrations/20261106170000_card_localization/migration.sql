-- Nome/imagem das cartas em outros idiomas (ex.: pt). Apenas cria uma tabela nova:
-- nenhuma coluna ou linha existente é alterada ou removida (migration não destrutiva).

-- CreateTable
CREATE TABLE "CardCatalogLocalization" (
    "id" TEXT NOT NULL,
    "cardCatalogId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT,
    "setName" TEXT,
    "imageUrl" TEXT,
    "imageLargeUrl" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardCatalogLocalization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardCatalogLocalization_cardCatalogId_language_key" ON "CardCatalogLocalization"("cardCatalogId", "language");

-- AddForeignKey
ALTER TABLE "CardCatalogLocalization" ADD CONSTRAINT "CardCatalogLocalization_cardCatalogId_fkey" FOREIGN KEY ("cardCatalogId") REFERENCES "CardCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
