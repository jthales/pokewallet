import type { Prisma, PrismaClient } from '@prisma/client';

export class CollectionItemRepository {
  constructor(private readonly prisma: PrismaClient) {}

  createMany(items: Prisma.CollectionItemCreateManyInput[]) {
    return this.prisma.$transaction(items.map((data) => this.prisma.collectionItem.create({ data })));
  }

  findById(id: string) {
    return this.prisma.collectionItem.findUnique({
      where: { id },
      include: { cardCatalog: true, sales: { where: { cancelledAt: null } } },
    });
  }

  update(id: string, data: Prisma.CollectionItemUpdateInput) {
    return this.prisma.collectionItem.update({ where: { id }, data });
  }

  delete(id: string) {
    return this.prisma.collectionItem.delete({ where: { id } });
  }

  listByCard(cardCatalogId: string) {
    return this.prisma.collectionItem.findMany({
      where: { cardCatalogId },
      orderBy: { createdAt: 'asc' },
      include: { sales: { where: { cancelledAt: null }, orderBy: { soldAt: 'desc' } } },
    });
  }

  countByStatus() {
    return this.prisma.collectionItem.groupBy({ by: ['status'], _count: { _all: true } });
  }
}
