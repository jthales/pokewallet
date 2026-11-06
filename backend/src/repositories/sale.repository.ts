import type { PrismaClient } from '@prisma/client';

export class SaleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string) {
    return this.prisma.sale.findUnique({ where: { id }, include: { collectionItem: { include: { cardCatalog: true } } } });
  }

  list(includeCancelled: boolean) {
    return this.prisma.sale.findMany({
      where: includeCancelled ? {} : { cancelledAt: null },
      orderBy: [{ soldAt: 'desc' }, { createdAt: 'desc' }],
      include: { collectionItem: { include: { cardCatalog: true } } },
    });
  }
}
