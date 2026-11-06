import type { Prisma, PrismaClient } from '@prisma/client';
import type { CatalogCard } from '../integrations/catalog-provider.js';

export class CardCatalogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByExternal(provider: string, externalId: string) {
    return this.prisma.cardCatalog.findUnique({ where: { provider_externalId: { provider, externalId } } });
  }

  findById(id: string) {
    return this.prisma.cardCatalog.findUnique({ where: { id } });
  }

  /** Grava (ou atualiza) os metadados locais de uma carta vinda do fornecedor. */
  upsertFromProvider(card: CatalogCard) {
    const metadata: Prisma.InputJsonValue = {
      language: card.language,
      category: card.category,
      illustrator: card.illustrator,
      imageLarge: card.image?.large ?? null,
      setLogoUrl: card.set.logoUrl,
      setSymbolUrl: card.set.symbolUrl,
      setOfficialCount: card.set.officialCount,
      setTotalCount: card.set.totalCount,
      serieId: card.set.serieId ?? null,
      variants: card.variants ? { ...card.variants } : null,
    };
    const data = {
      name: card.name,
      localNumber: card.localNumber,
      setId: card.set.externalId,
      setName: card.set.name,
      rarity: card.rarity,
      imageUrl: card.image?.small ?? null,
      metadata,
    };
    return this.prisma.cardCatalog.upsert({
      where: { provider_externalId: { provider: card.provider, externalId: card.externalId } },
      create: { provider: card.provider, externalId: card.externalId, ...data },
      update: data,
    });
  }

  /** Remove registros de catálogo que não têm mais exemplares. */
  async deleteIfOrphan(id: string) {
    const count = await this.prisma.collectionItem.count({ where: { cardCatalogId: id } });
    if (count === 0) await this.prisma.cardCatalog.delete({ where: { id } });
  }
}
