import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { SaleRepository } from '../repositories/sale.repository.js';
import type { SellItemInput, UpdateSaleInput } from '../schemas/index.js';

export class SalesService {
  private readonly sales: SaleRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.sales = new SaleRepository(prisma);
  }

  /** Marca um exemplar como vendido. Os demais exemplares da mesma carta continuam disponíveis. */
  async sell(itemId: string, input: SellItemInput) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const item = await tx.collectionItem.findUnique({ where: { id: itemId } });
        if (!item) throw notFound('Exemplar');
        // A atualização condicional garante que duas requisições simultâneas não vendam o mesmo exemplar.
        const updated = await tx.collectionItem.updateMany({ where: { id: itemId, status: 'AVAILABLE' }, data: { status: 'SOLD' } });
        if (updated.count === 0) throw conflict('ALREADY_SOLD', 'Este exemplar já está marcado como vendido.');
        return tx.sale.create({
          data: { collectionItemId: itemId, soldAt: input.soldAt, salePriceCents: input.salePriceCents, notes: input.notes ?? null },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('ALREADY_SOLD', 'Este exemplar já está marcado como vendido.');
      }
      throw error;
    }
  }

  /** Corrige data, valor ou observações de uma venda registrada. */
  async update(saleId: string, input: UpdateSaleInput) {
    const sale = await this.sales.findById(saleId);
    if (!sale) throw notFound('Venda');
    if (sale.cancelledAt) throw new AppError(409, 'SALE_CANCELLED', 'Esta venda foi desfeita e não pode ser editada.');
    return this.prisma.sale.update({ where: { id: saleId }, data: input });
  }

  /** Desfaz uma venda: o exemplar volta a ficar disponível e o registro fica no histórico como cancelado. */
  async cancel(saleId: string) {
    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({ where: { id: saleId } });
      if (!sale) throw notFound('Venda');
      if (sale.cancelledAt) throw new AppError(409, 'SALE_CANCELLED', 'Esta venda já foi desfeita.');
      const cancelled = await tx.sale.update({ where: { id: saleId }, data: { cancelledAt: new Date() } });
      await tx.collectionItem.update({ where: { id: sale.collectionItemId }, data: { status: 'AVAILABLE' } });
      return cancelled;
    });
  }

  async list(includeCancelled: boolean) {
    const sales = await this.sales.list(includeCancelled);
    const active = sales.filter((s) => !s.cancelledAt);
    return {
      totals: { count: active.length, revenueCents: active.reduce((sum, s) => sum + s.salePriceCents, 0), currency: 'BRL' },
      sales: sales.map((s) => ({
        id: s.id,
        soldAt: s.soldAt,
        salePriceCents: s.salePriceCents,
        currency: s.currency,
        notes: s.notes,
        cancelledAt: s.cancelledAt,
        createdAt: s.createdAt,
        item: {
          id: s.collectionItem.id,
          condition: s.collectionItem.condition,
          variant: s.collectionItem.variant,
          language: s.collectionItem.language,
          purchasePriceCents: s.collectionItem.purchasePriceCents,
        },
        card: {
          id: s.collectionItem.cardCatalog.id,
          name: s.collectionItem.cardCatalog.name,
          setName: s.collectionItem.cardCatalog.setName,
          localNumber: s.collectionItem.cardCatalog.localNumber,
          imageUrl: s.collectionItem.cardCatalog.imageUrl,
        },
      })),
    };
  }
}
