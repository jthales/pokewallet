import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { SaleRepository } from '../repositories/sale.repository.js';
import type { SellItemInput, UpdateSaleInput } from '../schemas/index.js';
import { costInBRL } from './portfolio.service.js';
import { realizedResult } from './portfolio-analytics.js';
import { localizeCard } from './card-localization.js';

type ItemWithCard = Prisma.CollectionItemGetPayload<{ include: { cardCatalog: { include: { localizations: true } } } }>;

/** Carta da venda com nome/imagem no idioma do exemplar vendido. */
function toSaleCard(item: ItemWithCard) {
  const loc = localizeCard(item.cardCatalog, item.cardCatalog.localizations, item.language);
  return {
    id: item.cardCatalog.id,
    name: loc.name,
    setName: loc.setName,
    localNumber: item.cardCatalog.localNumber,
    imageUrl: loc.imageUrl,
    imageFallbackUrl: loc.imageFallbackUrl,
  };
}

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
          data: { collectionItemId: itemId, soldAt: input.soldAt, salePriceCents: input.salePriceCents, feesCents: input.feesCents ?? null, notes: input.notes ?? null },
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
    const realized = (s: (typeof sales)[number]) =>
      realizedResult(costInBRL(s.collectionItem), { priceCents: s.salePriceCents, feesCents: s.feesCents });
    const known = active.map(realized).filter((r): r is number => r !== null);
    return {
      totals: {
        count: active.length,
        revenueCents: active.reduce((sum, s) => sum + s.salePriceCents, 0),
        feesCents: active.reduce((sum, s) => sum + (s.feesCents ?? 0), 0),
        realizedCents: known.reduce((a, b) => a + b, 0),
        salesWithoutCost: active.length - known.length,
        currency: 'BRL',
      },
      sales: sales.map((s) => ({
        id: s.id,
        soldAt: s.soldAt,
        salePriceCents: s.salePriceCents,
        feesCents: s.feesCents,
        realizedCents: realized(s),
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
          purchaseCurrency: s.collectionItem.currency,
          costCents: costInBRL(s.collectionItem),
        },
        card: toSaleCard(s.collectionItem),
      })),
    };
  }
}
